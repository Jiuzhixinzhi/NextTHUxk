// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 志愿号解析（zyCache 水合/持久 + 缺号补齐策略）
// B3 自 session.resolveCourseZy 独立；分配核见 domain/zy。
// 本模块不 import session（ctx/isQueuePhase 由调用方传入，避免环）。
// ═══════════════════════════════════════════════════════════════
import type { Course, Ctx } from '../domain/types';
import { TAG } from '../core/constants';
import { keyOf } from '../core/utils';
import { K, store } from '../storage/store';
import { fetchLevelTable } from '../api/records';
import { assignZy, applyZyAnswers, applyZyDefaults, type ZyCacheMap } from '../domain/zy';
import { zyConfirm } from './modal.svelte.ts';

let zyCache: ZyCacheMap = {};
let zySem = '';

/** 启动/换学期水合：{sem, map} 防御读——异学期或旧形态（v3.4 前裸 map / 真值非对象）即弃。
 *  回归修复：v3 改写期丢了水合读取（v2 state.js:554 每次 refreshSelected 前 store.get），
 *  zyCache 沦为只写不读，手填志愿号跨会话丢失而存储持续堆积。 */
export function zyCacheHydrate(sem: string): void {
  zySem = sem;
  zyCache = {};
  store
    .get<{ sem: string; map: ZyCacheMap }>(K.zyCache)
    .then(c => {
      if (!c || c.sem !== zySem || !c.map || typeof c.map !== 'object') return;
      zyCache = Object.assign({}, c.map);
      console.log(TAG, 'zy cache hydrated:', Object.keys(zyCache).length, '门');
    })
    .catch(() => {});
}

async function persist(): Promise<void> {
  try {
    await store.set(K.zyCache, { sem: zySem, map: zyCache });
  } catch {
    /* fail-soft */
  }
}

/** 已选行志愿号解析：server 权威值落缓存；缺号时按阶段兜底（排队默认 3 /
 *  浏览弹窗询问），有写入才落盘。返回缓存是否更新。
 *  v2 语义恢复：手填结果 confirmed:true 持久——下次不再询问；
 *  排队默认 3 保持 confirmed:false（教务正式数据到货即覆盖）。 */
export async function resolveCourseZy(
  courses: Course[],
  selMap: Record<string, Course>,
  ctx: Ctx,
  opts: { withModal: boolean; isQueuePhase: boolean },
): Promise<boolean> {
  const res = await assignZy(courses, selMap, zyCache, () => fetchLevelTable(ctx));
  let cacheUpdated = res.cacheUpdated;
  if (res.missingZy.length) {
    if (opts.isQueuePhase) {
      cacheUpdated = applyZyDefaults(res.missingZy, zyCache) || cacheUpdated;
    } else if (opts.withModal) {
      const values = await zyConfirm(res.missingZy);
      cacheUpdated = applyZyAnswers(res.missingZy, values, zyCache) || cacheUpdated;
    }
  }
  if (cacheUpdated) await persist();
  return cacheUpdated;
}

/** 启动后补问（launch 后台尾部 fire-and-forget）：缺志愿号的已选行一次性询问。
 *  confirmed 缓存命中则零弹窗（assignZy 静默回填）；全部有号则零请求零弹窗。
 *  仅迭代已选行——不动搜索并入的未选池行（避免清掉其志愿统计展示字段）。 */
export async function resolveZyMissing(ctx: Ctx, courses: Course[], isQueuePhase: boolean): Promise<void> {
  const sel = courses.filter(c => c.selected);
  if (!sel.length || !sel.some(c => !(c.zy && c.zy > 0))) return;
  const selMap: Record<string, Course> = {};
  sel.forEach(s => {
    selMap[keyOf(s.code, s.seq)] = s;
  });
  await resolveCourseZy(sel, selMap, ctx, { withModal: true, isQueuePhase }).catch(() => {});
}
