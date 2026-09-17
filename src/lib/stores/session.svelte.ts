// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 会话状态：池 / 已选 / 候补 / 课余量 / 培养方案 / 手动占用
// 纯状态 + 刷新/动作接线；启动编排在 launch.svelte.ts、志愿号解析在
// zy.svelte.ts、元数据回填在 backfill.svelte.ts（B3 拆解）。
// ═══════════════════════════════════════════════════════════════
import type { Course, Ctx, DraftCourse, ManualEvent, PlanCourse, QueueDatum } from '../domain/types';
import { TAG } from '../core/constants';
import { keyOf } from '../core/utils';
import { K, store } from '../storage/store';
import { makeKnoteRemember, type KnoteMap } from '../storage/knote';
import { ensureSiteIdentity } from '../site/webvpn';
import { fetchPageRaw, setWebvpnReenter } from '../net/http';
import { isSsoLoginHtml, isXkDeadHtml } from '../api/search';
import {
  applyLevelMap,
  fetchCandidateCourses,
  fetchCourseDetail,
  fetchLevelTable,
  fetchQueueData,
  fetchSelectedCourses,
} from '../api/records';
import { applyVolunteer } from '../api/volunteers';
import { dropCourse, submitCourse, changeVolunteer } from '../api/write';
import { attachScores } from '../api/scores';
import { buildPreviewSpans, type PreviewSpan } from '../domain/conflict';
import { markCandidates, mergePoolRows, applyQueueToPool, mergeCandidateRows } from '../domain/pool';
import { checkPlanCoverage } from '../domain/plancov';
import { type LevelInfo } from '../domain/zy';
import { showToast, showXkResult } from './toast.svelte.ts';
import { confirmDialog } from './modal.svelte.ts';
import { vol, volCachePersist, volNewDepts, volNeedsDeptRetry, scheduleVolFetch, fetchVolForPool, type VolApplyCtx } from './volunteer.svelte.ts';
import { resolveCourseZy } from './zy.svelte.ts';
import { backfillCandidateMeta } from './backfill.svelte.ts';
import { emitServerRowsMerged, emitSelectedChanged, fgBusy } from './bus.svelte.ts';
import { tbAttach } from '../reviews/reviews';

export type { LevelInfo };

export const session = $state({
  open: false,
  launching: false,
  SEM: '',
  BASE: '',
  isZhjwxk: false,
  isZhjw: false,
  isWebvpn: false,
  allCourses: [] as Course[],
  candidateCourses: [] as Course[],
  /** 本轮候补名单是否权威取得（fetchCandidateCourses.ok）：决定草稿排队标记清理与提交过滤可否信任 */
  candidateFetchOk: false,
  levelMap: {} as Record<string, LevelInfo>,
  planData: [] as PlanCourse[],
  queueDataMap: {} as Record<string, QueueDatum>,
  isQueuePhase: false,
  knote: {} as KnoteMap,
  manualEvents: [] as ManualEvent[],
  fetchWarn: '',
  upcomingSync: 0,
});

export const knoteRemember = makeKnoteRemember(() => session.knote);

export function ctx(): Ctx {
  return { SEM: session.SEM, BASE: session.BASE, isZhjwxk: session.isZhjwxk, isZhjw: session.isZhjw, isWebvpn: session.isWebvpn };
}

function vctx(): VolApplyCtx & Ctx {
  return { allCourses: session.allCourses, searchRows: null, sem: session.SEM, ...ctx() };
}

/** 已选 + 候补（非重复）预览行 —— 去重按 keyOf（课序前导零归一；旧版原始字符串
 *  比较让 '01'/'1' 同课班混入两行，课表预览出现两个相同块） */
export function selectedPreviewRows(): Course[] {
  const sel = session.allCourses.filter(c => c.selected);
  const seen = new Set(sel.map(c => keyOf(c.code, c.seq)));
  const cand = session.candidateCourses.filter(cc => !seen.has(keyOf(cc.code, cc.seq)));
  return sel.concat(cand);
}

/** 预览冲突时段表（已选/候补行 + 自定义占用）——全列表共用一份：
 *  卡片冲突徽章与搜索「冲突」筛选同源，避免每卡各自 buildPreviewSpans。
 *  响应式：读 $state，组件以 $derived.by(() => previewConflictSpans()) 包裹。 */
export function previewConflictSpans(): PreviewSpan[] {
  return buildPreviewSpans(selectedPreviewRows(), session.manualEvents);
}

/** 培养方案覆盖（正选 + 全部草稿）——launch 完成后（bus onLaunchDone）与草稿/已选变更时重算。
 *  历史缺陷：曾用普通 let 导出（非响应式），且首开时 loadDrafts 先于 launch、池为空漏算，
 *  卡片「等待加载」直到返回原系统再开启（重开时池非空、挂载前恰好算好）才出现。 */
export const planCov = $state({ rows: [] as ReturnType<typeof checkPlanCoverage> });
export function refreshPlanCoverage(drafts: DraftCourse[][]): void {
  planCov.rows = checkPlanCoverage(session.planData, session.allCourses, drafts);
}

// ─── 站点识别（boot 时调用一次） ───────────────────────────────

export async function bootSite(): Promise<void> {
  const id = await ensureSiteIdentity(location);
  session.SEM = (location.pathname.match(/p_xnxq=([^&]+)/) || ['', ''])[1]!;
  session.BASE = id.BASE;
  session.isZhjwxk = id.isZhjwxk;
  session.isZhjw = id.isZhjw;
  session.isWebvpn = id.isWebvpn;
  setWebvpnReenter(reenterXkRoot);
}

/** WebVPN 票据自愈：重进一次教务入口根（BASE）换票（wengine_vpn_ticket 过期而
 *  主会话活着的实录修法，上游 v2.0.1 同款）。入口根也是死页 = 主会话真死，如实返回。 */
async function reenterXkRoot(): Promise<boolean> {
  try {
    const html = await fetchPageRaw(session.BASE + '/');
    // SSO 登录页也算「入口根已死」：换票救不了（主会话真没了），不再白跑重进
    const ok = !isXkDeadHtml(html) && !isSsoLoginHtml(html);
    console.log(TAG, 'webvpn 重进入口换票:', ok ? '成功，重试原请求' : '入口根也是死页，主会话真死，需重新登录');
    return ok;
  } catch (e) {
    console.warn(TAG, 'webvpn 重进入口失败:', e);
    return false;
  }
}

// ─── 已选 / 候补 / 志愿刷新 ───────────────────────────────────

/** 刷新已选/候补/余量（选退课后的校准正源）。
 *  withModal 默认 true（v2 语义）——但当前所有调用点都显式传 false：提交动作后的校准时
 *  不打扰（confirmed 缓存命中本就零弹窗），缺志愿号的补问统一由 launch 后台尾部
 *  `resolveZyMissing`（zy.svelte.ts，withModal=true）负责，避免动作后多次弹窗。 */
export async function refreshSelected(withModal = true): Promise<void> {
  const selected = await fetchSelectedCourses(ctx());
  const selMap: Record<string, Course> = {};
  selected.forEach(s => {
    selMap[keyOf(s.code, s.seq)] = s;
  });
  session.levelMap = await fetchLevelTable(ctx()).catch(() => session.levelMap || {});
  applyLevelMap(session.allCourses, session.levelMap, session.planData);
  await resolveCourseZy(session.allCourses, selMap, ctx(), { withModal, isQueuePhase: session.isQueuePhase }).catch(() => {});
  try {
    const cr = await fetchCandidateCourses(ctx());
    session.candidateCourses = cr.rows;
    session.candidateFetchOk = cr.ok;
  } catch {
    /* 保持现有候补数据不变；标记置不可信，避免 promote 依据过期名单 */
    session.candidateFetchOk = false;
  }
  markCandidates(session.allCourses, session.candidateCourses);
  try {
    const qResult = await fetchQueueData(ctx(), session.allCourses);
    session.queueDataMap = qResult.map;
    session.isQueuePhase = qResult.phase;
    if (session.isQueuePhase) {
      applyQueueToPool(session.allCourses, session.queueDataMap);
    } else if (Object.keys(vol.map).length) {
      applyVolunteer(session.allCourses, vol.map);
    }
  } catch {
    /* 保持现有余量数据 */
  }
  emitSelectedChanged();
}

/** 检查点同步：队列 + 候补 + 余量 + 志愿（fire-and-forget 完成后再回渲） */
export async function syncQueueAndVol(): Promise<void> {
  const qResult = await fetchQueueData(ctx(), session.allCourses);
  session.queueDataMap = qResult.map;
  session.isQueuePhase = qResult.phase;
  const cr = await fetchCandidateCourses(ctx());
  session.candidateCourses = cr.rows;
  session.candidateFetchOk = cr.ok;
  // 检查点同步（定时器触发）：候补回填过前台闸门，避免与浏览翻页并发 kkxxSearch
  if (session.candidateCourses.length) await backfillCandidateMeta(ctx(), session.candidateCourses, fgBusy).catch(() => {});
  markCandidates(session.allCourses, session.candidateCourses);
  mergeCandidateRows(session.allCourses, session.candidateCourses);
  applyQueueToPool(session.allCourses, session.queueDataMap);
  if (!session.isQueuePhase) {
    void (async () => {
      try {
        const vctxAll: VolApplyCtx & Ctx = { allCourses: session.allCourses, searchRows: null, sem: session.SEM, ...ctx() };
        await fetchVolForPool(vctxAll, session.allCourses, false);
        volCachePersist(session.SEM);
      } catch (e) {
        console.warn(TAG, 'volunteer sync:', e);
      }
    })();
  }
}

// ─── 选退课代理（供组件调用；随后刷新会话） ────────────────────

export async function doSubmitCourse(code: string, seq: string, zy: number, flag: string): Promise<{ ok: boolean; msg: string }> {
  const res = await submitCourse(ctx(), code, seq, zy, (flag as never) ?? 'bx');
  if (res.ok) await refreshSelected(false);
  else await refreshSelected(false).catch(() => {});
  return { ok: res.ok, msg: res.msg };
}

/** 退选/退队当日本地摘牌（上游 #36-5 同款）：不等网络往返，立即清池行选中态 +
 *  剔出候补列表；后台 refreshSelected 兜底校准（失败保持已摘牌，下次手动刷新自愈）。 */
function applyLocalRemoval(code: string, seq: string): void {
  const k = keyOf(code, seq);
  const row = session.allCourses.find(c => keyOf(c.code, c.seq) === k);
  if (row) {
    row.selected = false;
    row.isCandidate = false;
    row.zy = 0;
    row.queue = '';
  }
  session.candidateCourses = session.candidateCourses.filter(c => keyOf(c.code, c.seq) !== k);
  emitSelectedChanged();
}

export async function doDropCourse(code: string, seq: string): Promise<{ ok: boolean; msg: string }> {
  const isQueue = session.candidateCourses.some(c => keyOf(c.code, c.seq) === keyOf(code, seq));
  const res = await dropCourse(ctx(), code, seq, isQueue);
  if (res.ok) {
    applyLocalRemoval(code, seq);
    void refreshSelected(false).catch(() => {});
  }
  return { ok: res.ok, msg: res.msg };
}

export async function doChangeVolunteer(code: string, seq: string, targetZy: number): Promise<{ ok: boolean; msg: string }> {
  const res = await changeVolunteer(ctx(), code, seq, targetZy);
  if (res.ok) await refreshSelected(false);
  return { ok: res.ok, msg: res.msg };
}

// ─── 单课动作互斥（同一课班在途动作拒绝重入）────────────────────

/** 在途单课动作键（组件据此禁用按钮）：候选队列/课表预览历史上没有守卫，
 *  连点会并发提交同一课班的退选/退队（双提交窗口） */
export const courseActionBusy = $state({ keys: [] as string[] });

export function isCourseActionBusy(code: string, seq: string): boolean {
  return courseActionBusy.keys.includes(keyOf(code, seq));
}

/** 退选/退队流程（确认文案 + 互斥 + 结果 toast）：课程卡 / 候选队列 / 课表预览共用
 *  是否候补按当时名单判定（单一口径），调用方只需给课班与展示名。
 *  互斥键在确认弹窗之前登记（覆盖「确认 → 提交」全程）：连点不会叠出第二个弹窗，
 *  也不会让首问的 promise 悬空（后问会覆盖 modal.cur） */
export async function dropCourseFlow(code: string, seq: string, name?: string): Promise<void> {
  const k = keyOf(code, seq);
  if (courseActionBusy.keys.includes(k)) return;
  courseActionBusy.keys = [...courseActionBusy.keys, k];
  try {
    const isQueue = session.candidateCourses.some(c => keyOf(c.code, c.seq) === k);
    const label = name || code;
    const ok = await confirmDialog(
      isQueue ? `退出候补队列「${label}」？` : `退选「${label}」？`,
      isQueue ? '候补位次将丢失，重新排队需等待。' : '教务确认后生效。',
    );
    if (!ok) return;
    const res = await doDropCourse(code, seq);
    showToast(res.ok, res.msg);
  } finally {
    courseActionBusy.keys = courseActionBusy.keys.filter(x => x !== k);
  }
}

// ─── 课程行合并（搜索/回填行 → 会话池）────────────────────────

/** 合并服务端搜索行（code_seq 去重；回填缺失字段；借用已选/候补时间）
 *  合并策略全在 domain/pool.mergePoolRows（纯函数、可测），此处只做副作用接线 */
export function mergeRows(rows: Course[]): number {
  if (!rows || !rows.length) return 0;
  const { added, filled } = mergePoolRows(session.allCourses, rows, r =>
    knoteRemember(r.code, r.seq, r.note || r.xkTextNote || '', r.time || ''),
  );
  // 每次合并都补挂（校评 + 社区评价）：重复行（added=0）的展示对象是本次新解析的行，
  // 不挂会让搜索结果的徽章丢失（刷新首搜显示、再搜消失）；未就绪时空转，下次合并自愈
  attachScores(rows);
  tbAttach(rows);
  applyLevelMap(rows, session.levelMap, session.planData);
  if (rows.length) {
    const wa = rows.filter(r => r.attr).length;
    console.log(TAG, 'server rows 属性: ' + wa + '/' + rows.length + ' | 样例: ' + rows.slice(0, 3).map(r => keyOf(r.code, r.seq) + '→' + (r.attr || '空')).join(' , '));
  }
  if (!session.isQueuePhase) {
    if (Object.keys(vol.map).length) applyVolunteer(rows, vol.map);
    const newDepts = volNewDepts(rows);
    if (newDepts.length || volNeedsDeptRetry(rows)) {
      scheduleVolFetch(vctx(), rows, newDepts);
    }
  }
  emitServerRowsMerged(rows, filled);
  return added;
}

// ─── 手动占用 ─────────────────────────────────────────────────

export async function addManualEvent(name: string, day: number, begin: string, end: string): Promise<void> {
  const now = Date.now();
  session.manualEvents.push({ id: now, name, code: 'manual-' + now, seq: '0', day, begin, end, time: '', manual: true, credits: 0 });
  // $state Proxy 不能直传 storage（序列化失败会静默丢持久化）——与全库惯例一致先深拷贝
  try {
    await store.set(K.manualEvents, JSON.parse(JSON.stringify(session.manualEvents)));
  } catch (e) {
    showXkResult({ ok: false, msg: '占用保存失败（重启后将丢失）：' + ((e as Error).message || String(e)) });
    return;
  }
  showXkResult({ ok: true, msg: `已添加「${name}」（周${'一二三四五六日'[day - 1]} ${begin}-${end}）` });
}

export async function removeManualEvent(id: number): Promise<void> {
  const idx = session.manualEvents.findIndex(e => String(e.id) === String(id));
  if (idx < 0) return;
  const name = session.manualEvents[idx]!.name;
  session.manualEvents.splice(idx, 1);
  try {
    await store.set(K.manualEvents, JSON.parse(JSON.stringify(session.manualEvents)));
  } catch (e) {
    showXkResult({ ok: false, msg: '占用删除保存失败（重启后或恢复）：' + ((e as Error).message || String(e)) });
    return;
  }
  showXkResult({ ok: true, msg: '已删除「' + name + '」' });
}

export async function fetchDetail(teacherId: string, code: string): Promise<Record<string, string> | null> {
  return fetchCourseDetail(ctx(), teacherId, code);
}
