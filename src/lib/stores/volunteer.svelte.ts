// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 志愿统计状态（volMap + 检查点窗口缓存 + 院内自愈）
// ═══════════════════════════════════════════════════════════════
import type { Course, VolDatum } from '../domain/types';
import { TAG, VOL_RETRY_BUDGET } from '../core/constants';
import { fmtTime, keyOf } from '../core/utils';
import { K, store } from '../storage/store';
import { applyVolunteer, fetchVolCourse, fetchVolunteer } from '../api/volunteers';
import { deptOfCourse } from '../api/dept';
import { nextVolCheckpoint, volNeedsRefresh, volWindowStart } from '../update/check';
import { recordVolWindow } from './probhist.svelte.ts';

export const vol = $state({
  map: {} as Record<string, VolDatum>,
  nextSyncAt: 0,
  syncing: false,
});

// ─── 志愿抓取会话状态（唯一写者＝本模块；api/volunteers 无状态化）─────
/** 院系 → 最近抓取时间戳（含 'ty'）——检查点窗口新鲜度判定源 */
const depts: Record<string, number> = {};
/** 缺行自愈预算计数（院系码 / 'k:'+课号），每会话 VOL_RETRY_BUDGET 次 */
const retried: Record<string, number> = {};

let persistT: ReturnType<typeof setTimeout> | undefined;

/** 志愿缓存水合：同学期 + 同检查点窗口 → volMap/depts 直接还原 */
export function volCacheHydrate(sem: string): void {
  store.get<{ sem: string; windowStart: number; map: Record<string, VolDatum>; depts: Record<string, number> }>(K.volCache)
    .then(c => {
      if (!c || !c.map || !c.depts) return;
      if (c.sem !== sem) return;
      if (c.windowStart !== volWindowStart().getTime()) return;
      vol.map = Object.assign({}, vol.map, c.map);
      Object.assign(depts, c.depts);
      console.log(TAG, 'vol cache hydrated:', Object.keys(c.map).length, 'rows,', Object.keys(c.depts).length, 'depts（窗口', fmtTime(c.windowStart), '）');
    })
    .catch(() => {});
}

/** 志愿缓存写回（防抖 2s；窗口起点调用时刻捕获；同时挂接概率趋势快照） */
export function volCachePersist(sem: string): void {
  clearTimeout(persistT);
  const win = volWindowStart().getTime();
  recordVolWindow(sem, vol.map);
  persistT = setTimeout(() => {
    clearTimeout(persistT);
    complete();
  }, 2000);
  function complete() {
    // vol.map 是 $state Proxy，直传 storage 序列化会失败——先深拷贝（失败时 store.set 内部已 console.warn）
    store
      .set(K.volCache, { sem, windowStart: win, map: JSON.parse(JSON.stringify(vol.map)), depts })
      .catch(() => {});
  }
}

/** 备份导入的志愿缓存并入（仅同检查点窗口才收——跨窗口数据陈旧，展示会失真）。
 *  语义与 volCacheHydrate 同构：同窗快照视为权威整覆盖；depts 时间戳只进不退。
 *  返回并入行数（新增键计 1）；窗口不符返回 -1。 */
export function mergeImportedVolCache(
  curSem: string,
  windowStart: number,
  map: Record<string, VolDatum>,
  deptsIn: Record<string, number>,
  targets: Course[],
): number {
  if (!curSem || !map || !Object.keys(map).length || windowStart !== volWindowStart().getTime()) return -1;
  let added = 0;
  const merged = Object.assign({}, vol.map) as Record<string, VolDatum>;
  for (const k of Object.keys(map)) {
    const v = map[k];
    if (!v || !v.code) continue;
    if (!merged[k]) added++;
    merged[k] = v;
  }
  vol.map = merged;
  const dep = deptsIn || {};
  for (const k of Object.keys(dep)) {
    const t = Number(dep[k]) || 0;
    if (t > 0 && (!depts[k] || depts[k]! < t)) depts[k] = t;
  }
  if (targets && targets.length) applyVolunteer(targets, vol.map);
  volCachePersist(curSem);
  return added;
}

/** 志愿自动同步定时器（到检查点触发回调再重新排程） */
let syncStarted = false;
let syncT: ReturnType<typeof setTimeout> | undefined;
export function startVolAutoSync(sem: string, onSync: () => Promise<void>): void {
  if (syncStarted) return;
  syncStarted = true;
  const schedule = () => {
    const next = nextVolCheckpoint(Date.now());
    vol.nextSyncAt = next.getTime();
    syncT = setTimeout(async () => {
      try {
        await onSync();
      } catch (e) {
        console.warn(TAG, '志愿检查点同步:', e);
      }
      schedule();
    }, Math.max(1000, next.getTime() - Date.now()));
  };
  schedule();
  void sem;
}

// ─── 会话状态查询（供 session/backup 使用；写者仍是本模块）────────

/** 院系抓取时间戳快照（备份导出用；返回浅拷贝，外部不可改内部状态） */
export function volDeptTimes(): Record<string, number> {
  return { ...depts };
}

/** 本批需要抓志愿统计的新院系（池内未见或已过检查点窗口） */
export function volNewDepts(rows: Course[]): string[] {
  return Array.from(new Set(rows.map(deptOfCourse).filter(Boolean))).filter(dc => !depts[dc] || volNeedsRefresh(depts[dc]!));
}

/** 缺行自愈判定：池内仍有缺志愿统计的行，且该院系未耗尽重试预算（排队阶段不补拉） */
export function volNeedsDeptRetry(rows: Course[], isQueuePhase: boolean): boolean {
  if (isQueuePhase) return false;
  return rows.some(r => {
    if (!(r && r.code)) return false;
    const dc = deptOfCourse(r);
    return !!dc && !vol.map[keyOf(r.code, r.seq)] && (retried[dc] || 0) < VOL_RETRY_BUDGET;
  });
}

/** 换学期重置：清空院系时间戳与缺行重试预算 */
export function volSessionReset(): void {
  Object.keys(depts).forEach(k => delete depts[k]);
  Object.keys(retried).forEach(k => delete retried[k]);
}

export interface VolApplyCtx {
  allCourses: Course[];
  searchRows: Course[] | null;
  sem: string;
}

/** 每次到货：合并 volMap 并对全部池行/搜索行重放志愿字段（幂等） */
export function mergeVolMap(partial: Record<string, VolDatum>, ctx: VolApplyCtx): void {
  vol.map = Object.assign({}, vol.map, partial);
  const targets = ctx.allCourses.concat(ctx.searchRows || []);
  applyVolunteer(targets, vol.map);
  const sem0 = ctx.sem;
  volCachePersist(sem0);
}

/** 池化拉取：fetchVolunteer + onDept 增量上屏 */
export async function fetchVolForPool(ctx: VolApplyCtx & { BASE: string; SEM: string; isZhjwxk: boolean; isZhjw: boolean; isWebvpn: boolean }, courses: Course[], force = false): Promise<Record<string, VolDatum>> {
  const partial = await fetchVolunteer(
    { BASE: ctx.BASE, SEM: ctx.SEM, isZhjwxk: ctx.isZhjwxk, isZhjw: ctx.isZhjw, isWebvpn: ctx.isWebvpn },
    courses,
    {
      force,
      needsRefresh: volNeedsRefresh,
      done: depts,
      onPersist: () => volCachePersist(ctx.SEM),
      onDept: m => {
        if (!m || !Object.keys(m).length) return;
        // 触发本批部分合并（并入已有 map 后重放）——注意 fetchVolunteer 传的
        // partial 只是增量；合并重放需在 map 上做
        vol.map = Object.assign({}, vol.map, m);
        const targets = ctx.allCourses.concat(ctx.searchRows || []);
        applyVolunteer(targets, vol.map);
        volCachePersist(ctx.SEM);
      },
    },
  );
  // 无条件回放（幂等）：launch 重建池行后若所有院系都还在检查点窗口内（partial 为空），
  // 池行仍会缺 vol 字段（概率标签消失）——必须回放缓存 vol.map
  vol.map = Object.assign({}, vol.map, partial);
  applyVolunteer(ctx.allCourses.concat(ctx.searchRows || []), vol.map);
  volCachePersist(ctx.SEM);
  return partial;
}

// ─── 按需补拉（mergeRows 防抖入口 + 缺行自愈，3 次/会话预算）─────
let debounceT: ReturnType<typeof setTimeout> | undefined;
let busy = false;
let pending: [Course[], string[]] | null = null;

export function scheduleVolFetch(ctx: VolApplyCtx & { BASE: string; SEM: string; isZhjwxk: boolean; isZhjw: boolean; isWebvpn: boolean }, rows: Course[], newDepts: string[]): void {
  clearTimeout(debounceT);
  debounceT = setTimeout(() => {
    debounceT = undefined;
    void runVolFetch(ctx, rows, newDepts);
  }, 60);
}

export async function runVolFetch(ctx: VolApplyCtx & { BASE: string; SEM: string; isZhjwxk: boolean; isZhjw: boolean; isWebvpn: boolean }, rows: Course[], newDepts: string[]): Promise<void> {
  if (busy) {
    pending = [rows, newDepts];
    return;
  }
  busy = true;
  try {
    console.log(TAG, 'volunteer 按需补拉院系:', newDepts.join(',') || '(缺行自愈)');
    const volr = await fetchVolForPool(ctx, rows, false);
    let extra: Record<string, VolDatum> = {};
    // 缺行自愈：volMap 仍缺的行对其院系定向强制重拉 + 逐课 p_kch（各 VOL_RETRY_BUDGET 次预算）
    const nk = (r: Course) => keyOf(r.code, r.seq);
    const scope = rows.concat(ctx.allCourses.filter(p => !rows.includes(p)));
    const missing = scope.filter(r => {
      if (!(r && r.code)) return false;
      const dc = deptOfCourse(r);
      return !!dc && !vol.map[nk(r)] && (retried[dc] || 0) < VOL_RETRY_BUDGET;
    });
    if (missing.length) {
      const mdeps = Array.from(new Set(missing.map(deptOfCourse)));
      mdeps.forEach(d => {
        retried[d] = (retried[d] || 0) + 1;
      });
      console.log(TAG, 'volunteer 缺行重拉:', mdeps.join(','));
      try {
        extra = await fetchVolForPool(ctx, missing, true);
        vol.map = Object.assign({}, vol.map, extra);
      } catch (e2) {
        console.warn(TAG, 'volunteer 缺行重拉失败', e2);
      }
      const rowsSet = new Set((rows || []).filter(Boolean));
      const kchTargets = missing.filter(r => rowsSet.has(r))
        .concat(missing.filter(r => !rowsSet.has(r)))
        .slice(0, 4);
      for (const r of kchTargets) {
        if (vol.map[nk(r)]) continue;
        if ((retried['k:' + r.code] || 0) >= VOL_RETRY_BUDGET) continue;
        retried['k:' + r.code] = (retried['k:' + r.code] || 0) + 1;
        try {
          const m2 = await fetchVolCourse({ BASE: ctx.BASE, SEM: ctx.SEM, isZhjwxk: ctx.isZhjwxk, isZhjw: ctx.isZhjw, isWebvpn: ctx.isWebvpn }, r.code);
          if (Object.keys(m2).length) {
            extra = Object.assign({}, extra, m2);
            vol.map = Object.assign({}, vol.map, m2);
          }
        } catch (e3) {
          console.warn(TAG, 'volunteer 定向课号查询失败', r.code, e3);
        }
      }
    }
    if (!Object.keys(volr).length && !Object.keys(extra).length) return;
    const targets = ctx.allCourses.concat(ctx.searchRows || []);
    applyVolunteer(targets, vol.map);
    volCachePersist(ctx.SEM);
  } catch (e) {
    console.warn(TAG, 'volunteer 按需补拉失败:', (newDepts || []).join(','), e);
  } finally {
    busy = false;
    if (pending) {
      const a = pending;
      pending = null;
      void runVolFetch(ctx, a[0], a[1]);
    }
  }
}

