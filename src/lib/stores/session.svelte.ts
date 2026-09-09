// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 会话状态：池 / 已选 / 候补 / 课余量 / 培养方案 / 手动占用
// 启动编排、已选刷新、课程行合并、已选时间回填。
// ═══════════════════════════════════════════════════════════════
import type { Course, Ctx, DraftCourse, ManualEvent, PlanCourse, QueueDatum, VolDatum } from '../domain/types';
import { DATA_VER, TAG } from '../core/constants';
import { keyOf, normSeq, sleep } from '../core/utils';
import { K, cleanupLegacyKeys, store } from '../storage/store';
import { knoteLoad, makeKnoteRemember, type KnoteMap } from '../storage/knote';
import { ensureSiteIdentity } from '../site/webvpn';
import { fetchPageRaw, setWebvpnReenter } from '../net/http';
import { fetchTrainingPlan } from '../api/plan';
import { isXkDeadHtml, serverSearch } from '../api/search';
import {
  applyLevelMap,
  backfillCandidateMeta,
  fetchCandidateCourses,
  fetchCategoryAttrs,
  fetchCourseDetail,
  fetchLevelTable,
  fetchQueueData,
  fetchSelectedCourses,
} from '../api/records';
import { applyVolunteer, volSession } from '../api/volunteers';
import { dropCourse, submitCourse, changeVolunteer } from '../api/write';
import { attachScores, ensureScores } from '../api/scores';
import { typeCodeToFlag } from '../domain/flags';
import { parseTimeSlots, clockRangesOf } from '../domain/time';
import { checkPlanCoverage } from '../domain/plancov';
import { showXkResult } from './toast.svelte.ts';
import { clearCardExpansions } from './uicards.svelte.ts';
import { promptDialog, zyConfirm } from './modal.svelte.ts';
import { vol, volCacheHydrate, volCachePersist, scheduleVolFetch, type VolApplyCtx } from './volunteer.svelte.ts';
import { probHistHydrate } from './probhist.svelte.ts';
import { emitServerRowsMerged, emitLaunchDone, emitSelectedChanged } from './bus.svelte.ts';
import { checkUpdate } from '../update/check';
import { ensureIndex, tbAttach, setOnIndexChange } from '../reviews/reviews';
import { deptOfCourse } from '../api/dept';
import { volNeedsRefresh as volNeedsRefreshLocal } from '../update/check';

export interface LevelInfo {
  typeCode: string;
  typeLabel: string;
  attr: string;
}

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

let zyCache: Record<string, { zy: number; typeCode: string; typeLabel: string; confirmed: boolean }> = {};
let zyCacheDirty = false;

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
    const ok = !isXkDeadHtml(html);
    console.log(TAG, 'webvpn 重进入口换票:', ok ? '成功，重试原请求' : '入口根也是死页，主会话真死，需重新登录');
    return ok;
  } catch (e) {
    console.warn(TAG, 'webvpn 重进入口失败:', e);
    return false;
  }
}

// ─── 启动编排 ─────────────────────────────────────────────────

export async function launch(): Promise<void> {
  if (session.launching) {
    showXkResult({ ok: false, msg: '正在加载中，请稍候…' });
    return;
  }
  session.launching = true;
  session.open = true;
  session.fetchWarn = '';
  try {
    if (!session.SEM && /p_xnxq=/.test(location.search)) {
      session.SEM = (location.search.match(/p_xnxq=([^&]+)/) || ['', ''])[1]!;
    } else if (!session.SEM) {
      session.SEM = (await store.get<string>(K.sem)) || '';
    }
    if (!session.SEM) {
      const val = await promptDialog('设置学期', '2026-2027-1', '如 2026-2027-1', '输入当前学期（默认 2026-2027-1）：');
      session.SEM = (val || '').trim() || '2026-2027-1';
    }
    await store.set(K.sem, session.SEM);
    const SEM0 = session.SEM;
    await cleanupLegacyKeys();
    session.manualEvents = (await store.get<ManualEvent[]>(K.manualEvents)) || [];
    let sd: { ver: number; plan: PlanCourse[] } | null = (await store.get<{ ver: number; plan: PlanCourse[] }>(K.staticData)) || null;
    if (sd && sd.ver !== DATA_VER) {
      console.log(TAG, 'data version mismatch, clearing cache');
      sd = null;
      await store.set(K.staticData, null).catch(() => {});
    }
    session.planData = sd?.plan || [];
    volCacheHydrate(session.SEM);
    probHistHydrate(session.SEM);
    console.log(TAG, 'on-demand mode: fetching selected + candidates + plan');
    const [selectedCourses, candCourses, planFresh, level, catAttrs] = await Promise.all([
      fetchSelectedCourses(ctx()).catch(e => {
        console.warn(TAG, 'selected:', e);
        return [];
      }),
      fetchCandidateCourses(ctx()).catch(e => {
        console.warn(TAG, 'candidates:', e);
        return [];
      }),
      session.planData.length ? Promise.resolve<PlanCourse[]>([]) : fetchTrainingPlan(ctx()).catch(e => {
        console.warn(TAG, 'plan:', e);
        return [];
      }),
      fetchLevelTable(ctx()).catch(e => {
        console.warn(TAG, 'level table:', e);
        return {};
      }),
      fetchCategoryAttrs(ctx()).catch(e => {
        console.warn(TAG, 'category attrs:', e);
        return {};
      }),
    ]);
    session.levelMap = Object.assign({}, level, catAttrs);
    if (!session.planData.length) session.planData = planFresh || [];
    session.candidateCourses = candCourses;
    if (candCourses.length) {
      await backfillCandidateMeta(ctx(), candCourses).catch(e => console.warn(TAG, 'cand meta:', e));
    }
    const pool: Course[] = selectedCourses.map(c => ({ ...c, selected: true }));
    session.candidateCourses.forEach(c => {
      if (!pool.some(p => keyOf(p.code, p.seq) === keyOf(c.code, c.seq))) pool.push({ ...c, isCandidate: true });
    });
    session.knote = await knoteLoad().catch(e => {
      console.warn(TAG, 'knote:', e);
      return {};
    });
    session.allCourses = pool;
    applyLevelMap(pool, session.levelMap, session.planData);
    // 重开场景：志愿院系均在检查点窗口内 fresh → 后台拉取返回空，池行会一直缺 vol 字段
    // （概率标签消失）。此处先用内存/缓存 vol.map 同步回放，后台到货后再刷新。
    if (Object.keys(vol.map).length) applyVolunteer(pool, vol.map);
    // 课余量/排队 + 志愿：非阻塞（UI 先上屏，数据后到回填）
    void (async () => {
      const qResult = await fetchQueueData(ctx(), pool).catch(e => {
        console.warn(TAG, 'queue:', e);
        return { map: {}, phase: false };
      });
      session.queueDataMap = qResult.map;
      session.isQueuePhase = qResult.phase;
      if (qResult.phase) {
        pool.forEach(c => {
          const q = session.queueDataMap[c.code + '_' + normSeq(c.seq)];
          if (q) {
            c.available = q.qRemaining > 0;
            if (q.qRemaining > 0) c.remaining = q.qRemaining;
            c.capacity = q.qCapacity;
          }
        });
      } else {
        try {
          await fetchVolForPoolLaunch(pool);
        } catch (e) {
          console.warn(TAG, 'volunteer:', e);
        }
      }
      if (session.SEM === SEM0) {
        await store.set(K.staticData, { ver: DATA_VER, plan: session.planData, ts: Date.now() }).catch(() => {});
      } else {
        console.warn(TAG, 'cache write skipped: semester switched during load', SEM0, '->', session.SEM);
      }
      if (session.fetchWarn) {
        const w = session.fetchWarn;
        session.fetchWarn = '';
        showXkResult({ ok: false, msg: w });
      }
    })();
    session.knote = Object.assign({}, session.knote);
    void backfillSelTimes();
    setOnIndexChange(() => {
      if (session.allCourses.length) {
        const r = tbAttach(session.allCourses);
        console.log(TAG, '[TB] 社区评价匹配', r.matched + '/' + r.total);
      }
    });
    ensureIndex()
      .then(ok => {
        if (!ok) return;
        const r = tbAttach(session.allCourses);
        console.log(TAG, '[TB] 社区评价匹配', r.matched + '/' + r.total, JSON.stringify({}));
      })
      .catch(() => {});
    // 校评（教务评教均分）：学期静止数据，缓存命中不发请求；全量拉取后回填池行
    ensureScores(ctx())
      .then(ok => {
        if (!ok) return;
        const r = attachScores(session.allCourses);
        console.log(TAG, '[Score] 校评匹配', r.matched + '/' + r.total);
      })
      .catch(() => {});
    startVolAutoSyncIfNeeded();
    checkUpdate({ onDanger: () => setBanner('danger'), onUpdate: (v, u) => setBanner('update', v, u) });
    const warn = session.fetchWarn;
    if (warn) {
      session.fetchWarn = '';
      showXkResult({ ok: false, msg: warn });
    }
    console.log(TAG, 'on-demand launch done:', pool.filter(c => c.selected).length, 'selected,', session.candidateCourses.length, 'candidates,', session.isQueuePhase ? 'queue phase' : 'browse mode');
  } catch (e) {
    showXkResult({ ok: false, msg: '启动失败：' + (e instanceof Error ? e.message : String(e)) });
  } finally {
    session.launching = false;
    emitLaunchDone();
  }
}

export const banner = $state({ kind: 'none' as 'none' | 'update' | 'danger', ver: '', url: '' });
export function setBanner(kind: 'update' | 'danger', ver?: string, url?: string): void {
  banner.kind = kind;
  if (ver) banner.ver = ver;
  if (url) banner.url = url;
}
export function clearBanner() {
  banner.kind = 'none';
}

// 版本号/构建显示：curVer() 由 core/constants 单源导出（Banner 等直接引用）

// ─── 志愿：launch 后台块 ─────────────────────────────────────
import { fetchVolForPool, startVolAutoSync } from './volunteer.svelte.ts';
async function fetchVolForPoolLaunch(pool: Course[]) {
  const vctxAll: VolApplyCtx & Ctx = { allCourses: pool, searchRows: null, sem: session.SEM, ...ctx() };
  await fetchVolForPool(vctxAll, pool, false);
  volCachePersist(session.SEM);
}
let autoSyncArmed = false;
function startVolAutoSyncIfNeeded() {
  if (autoSyncArmed) return;
  autoSyncArmed = true;
  startVolAutoSync(session.SEM, async () => {
    await syncQueueAndVol();
  });
}

// ─── 已选 / 候补 / 志愿刷新 ───────────────────────────────────

async function resolveCourseZy(courses: Course[], selMap: Record<string, Course>, withModal: boolean): Promise<boolean> {
  let cacheUpdated = false;
  const missingZy: Course[] = [];
  let levelMap: Record<string, LevelInfo> | null = null;
  let selectedChanged = false;
  for (const c of courses) {
    const key = c.code + '_' + (c.seq || '0');
    const s = selMap[key];
    if (c.selected !== !!s) selectedChanged = true;
    c.selected = !!s;
    if (s) {
      if (s.zy && s.zy > 0) {
        c.zy = s.zy;
        c.typeCode = s.typeCode || '';
        c.typeLabel = s.typeLabel || '';
        zyCache[key] = { zy: s.zy, typeCode: s.typeCode || '', typeLabel: s.typeLabel || '', confirmed: true };
        cacheUpdated = true;
      } else {
        const cached = zyCache[key];
        if (cached && cached.zy > 0 && cached.confirmed) {
          c.zy = cached.zy;
          c.typeCode = cached.typeCode;
          c.typeLabel = cached.typeLabel;
        } else {
          if (!levelMap) levelMap = await fetchLevelTable(ctx());
          const lt = levelMap[key];
          if (lt) {
            c.typeCode = lt.typeCode;
            c.typeLabel = lt.typeLabel;
          } else {
            c.typeCode = s.typeCode || '';
            c.typeLabel = s.typeLabel || '';
          }
          c.zy = cached && cached.zy > 0 ? cached.zy : 0;
          missingZy.push(c);
        }
      }
    } else {
      c.zy = 0;
      c.typeCode = '';
      c.typeLabel = '';
    }
  }
  if (missingZy.length) {
    if (session.isQueuePhase) {
      missingZy.forEach(c => {
        c.zy = 3;
        zyCache[c.code + '_' + (c.seq || '0')] = { zy: 3, typeCode: c.typeCode || '', typeLabel: c.typeLabel || '', confirmed: false };
      });
      cacheUpdated = true;
    } else if (withModal) {
      const values = await zyConfirm(missingZy);
      missingZy.forEach((c, i) => {
        if (values[i] && values[i]! > 0) {
          c.zy = values[i]!;
          zyCache[c.code + '_' + (c.seq || '0')] = { zy: c.zy, typeCode: c.typeCode || '', typeLabel: c.typeLabel || '', confirmed: false };
          cacheUpdated = true;
        }
      });
    }
  }
  if (zyCacheDirty || cacheUpdated) {
    zyCacheDirty = false;
    try {
      await store.set(K.zyCache, JSON.parse(JSON.stringify(zyCache)));
    } catch {
      /* fail-soft */
    }
  }
  return cacheUpdated;
}

export async function refreshSelected(withModal = true): Promise<void> {
  const selected = await fetchSelectedCourses(ctx());
  const selMap: Record<string, Course> = {};
  selected.forEach(s => {
    selMap[s.code + '_' + (s.seq || '0')] = s;
  });
  session.levelMap = await fetchLevelTable(ctx()).catch(() => session.levelMap || {});
  applyLevelMap(session.allCourses, session.levelMap, session.planData);
  await resolveCourseZy(session.allCourses, selMap, withModal).catch(() => {});
  try {
    session.candidateCourses = await fetchCandidateCourses(ctx());
  } catch {
    /* 保持现有候补数据不变 */
  }
  const candKeys = new Set(session.candidateCourses.map(c => c.code + '_' + String(c.seq || '0')));
  session.allCourses.forEach(c => {
    c.isCandidate = candKeys.has(c.code + '_' + (c.seq || '0'));
  });
  try {
    const qResult = await fetchQueueData(ctx(), session.allCourses);
    session.queueDataMap = qResult.map;
    session.isQueuePhase = qResult.phase;
    if (session.isQueuePhase) {
      session.allCourses.forEach(c => {
        const q = session.queueDataMap[c.code + '_' + normSeq(c.seq)];
        if (q) {
          c.available = q.qRemaining > 0;
          if (q.qRemaining > 0) c.remaining = q.qRemaining;
          c.capacity = q.qCapacity;
        }
      });
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
  session.candidateCourses = await fetchCandidateCourses(ctx());
  if (session.candidateCourses.length) await backfillCandidateMeta(ctx(), session.candidateCourses).catch(() => {});
  const candKeys = new Set(session.candidateCourses.map(c => c.code + '_' + String(c.seq || '0')));
  session.allCourses.forEach(c => {
    c.isCandidate = candKeys.has(c.code + '_' + String(c.seq || '0'));
  });
  session.candidateCourses.forEach(c => {
    if (!session.allCourses.some(ac => keyOf(ac.code, ac.seq) === keyOf(c.code, c.seq))) session.allCourses.push({ ...c, isCandidate: true });
  });
  session.allCourses.forEach(c => {
    const q = session.queueDataMap[c.code + '_' + normSeq(c.seq)];
    if (q) {
      c.available = q.qRemaining > 0;
      if (q.qRemaining > 0) c.remaining = q.qRemaining;
      c.capacity = q.qCapacity;
    }
  });
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

export async function doDropCourse(code: string, seq: string): Promise<{ ok: boolean; msg: string }> {
  const isQueue = session.candidateCourses.some(c => c.code === code && String(c.seq) === String(seq));
  const res = await dropCourse(ctx(), code, seq, isQueue);
  if (res.ok) await refreshSelected(false);
  return { ok: res.ok, msg: res.msg };
}

export async function doChangeVolunteer(code: string, seq: string, targetZy: number): Promise<{ ok: boolean; msg: string }> {
  const res = await changeVolunteer(ctx(), code, seq, targetZy);
  if (res.ok) await refreshSelected(false);
  return { ok: res.ok, msg: res.msg };
}

// ─── 课程行合并（搜索/回填行 → 会话池）────────────────────────

const parses = (c: Course) => parseTimeSlots(c.time || '').length > 0 || clockRangesOf(c.note || c.xkTextNote || '', c.time || '').length > 0;

/** 合并服务端搜索行（code_seq 去重；回填缺失字段；借用已选/候补时间） */
export function mergeRows(rows: Course[]): number {
  if (!rows || !rows.length) return 0;
  const byKey = new Map(session.allCourses.map(c => [keyOf(c.code, c.seq), c]));
  let added = 0;
  let filled = 0;
  const borrowersByCode = new Map<string, Course[]>();
  for (const c of session.allCourses) {
    if ((c.selected || c.isCandidate) && !parses(c)) {
      if (!borrowersByCode.has(c.code)) borrowersByCode.set(c.code, []);
      borrowersByCode.get(c.code)!.push(c);
    }
  }
  for (const r of rows) {
    const k = keyOf(r.code, r.seq);
    const ex = byKey.get(k);
    if (!ex) {
      session.allCourses.push(r);
      byKey.set(k, r);
      added++;
    } else {
      const before = ex.note + '|' + ex.time;
      if (!ex.note && r.note) ex.note = r.note;
      if (!ex.time && r.time) ex.time = r.time;
      else if (!parses(ex) && parses(r)) ex.time = r.time || ex.time;
      if (!ex.teacher && r.teacher) ex.teacher = r.teacher;
      if (!ex.credits && r.credits) ex.credits = r.credits;
      if (!ex.department && r.department) ex.department = r.department;
      if (!ex.xkTextNote && r.xkTextNote) ex.xkTextNote = r.xkTextNote;
      if (before !== ex.note + '|' + ex.time) filled++;
    }
    if (parses(r)) {
      knoteRemember(r.code, r.seq, r.note || r.xkTextNote || '', r.time || '');
      const borrowers = (borrowersByCode.get(r.code) || []).filter(ex2 => ex2 !== ex && !parses(ex2));
      for (const ex2 of borrowers) {
        if (!ex2.note && r.note) {
          ex2.note = r.note;
          filled++;
        }
        if (!parses(ex2) && r.time) {
          ex2.time = r.time;
          filled++;
        }
        if (!ex2.xkTextNote && (r.note || r.xkTextNote)) ex2.xkTextNote = r.note || r.xkTextNote;
      }
    }
  }
  // 每次合并都补挂（校评 + 社区评价）：重复行（added=0）的展示对象是本次新解析的行，
  // 不挂会让搜索结果的徽章丢失（刷新首搜显示、再搜消失）；未就绪时空转，下次合并自愈
  attachScores(rows);
  tbAttach(rows);
  applyLevelMap(rows, session.levelMap, session.planData);
  if (rows.length) {
    const wa = rows.filter(r => r.attr).length;
    console.log(TAG, 'server rows 属性: ' + wa + '/' + rows.length + ' | 样例: ' + rows.slice(0, 3).map(r => r.code + '_' + (r.seq || '0') + '→' + (r.attr || '空')).join(' , '));
  }
  if (!session.isQueuePhase) {
    if (Object.keys(vol.map).length) applyVolunteer(rows, vol.map);
    const newDepts = Array.from(new Set(rows.map(c => deptOfCourseFallback(c)).filter(Boolean))).filter(dc => !volSession.depts[dc] || volNeedsRefreshLocal(volSession.depts[dc]!));
    const retried = volSession.retried;
    const needRetry = rows.some(r => {
      if (!(r && r.code)) return false;
      const dc = deptOfCourseFallback(r);
      const has = !!vol.map[r.code + '_' + normSeq(r.seq || '0')];
      return !!dc && (session.isQueuePhase ? false : !has) && (retried[dc] || 0) < 3;
    });
    if (newDepts.length || needRetry) {
      scheduleVolFetch(vctx(), rows, newDepts);
    }
  }
  emitServerRowsMerged(rows, filled);
  return added;
}

function deptOfCourseFallback(c: Course): string {
  return deptOfCourse(c);
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

// ─── 已选时间回填（外校课时间在说明列，后台静默）───────────────

const _selTried = new Map<string, number>();
const _bfStatus: Record<string, string> = {};
let _bfScanP: Promise<Course[]> | null = null;
let _selBfLogged = false;

export async function backfillSelTimes(): Promise<void> {
  if (!session.isZhjwxk && !session.isWebvpn) return;
  const tried = _selTried;
  const sel = session.allCourses.filter(c => c.selected && !c.isCandidate);
  const unparsed = sel.filter(r => parseTimeSlots(r.time || '').length === 0 && clockRangesOf(r.note || r.xkTextNote || '', r.time || '').length === 0);
  const need = unparsed.filter(r => (tried.get(r.code + '_' + (r.seq || '0')) || 0) < 2);
  if (!need.length) {
    if (unparsed.length && !_selBfLogged) {
      _selBfLogged = true;
      console.log(TAG, '已选时间回填: 无可查——' + unparsed.length + ' 门解析不出（' + unparsed.map(r => r.code + '_' + (r.seq || '0') + ' time=[' + (r.time || '') + '] note=[' + ((r.note || r.xkTextNote) || '') + ']').join(' ; ') + '）');
    }
    return;
  }
  need.forEach(r => {
    const k = r.code + '_' + (r.seq || '0');
    tried.set(k, (tried.get(k) || 0) + 1);
  });
  need.forEach(r => {
    _bfStatus[r.code] = '查询中';
  });
  console.log(TAG, '已选时间回填: 查 ' + need.map(r => r.code + '_' + (r.seq || '0')).join(','));
  const outcome: string[] = [];
  for (let i = 0; i < need.length; i += 5) {
    await Promise.all(
      need.slice(i, i + 5).map(async r => {
        try {
          let res = await serverSearch(ctx(), { kch: r.code });
          let rows = res.rows || [];
          if (!rows.length && r.name) {
            const byName = await serverSearch(ctx(), { kcm: r.name });
            rows = byName.rows || [];
          }
          if (!rows.length) {
            if (!_bfScanP) {
              _bfScanP = (async () => {
                const scanned: Course[] = [];
                for (let p = 1; p <= 10; p++) {
                  try {
                    const res3 = await serverSearch(ctx(), { page: p });
                    const rs = res3.rows || [];
                    if (!rs.length) break;
                    scanned.push(...rs);
                  } catch {
                    break;
                  }
                }
                console.log(TAG, '回填浏览扫描: ' + scanned.length + ' 行（外校课号排序靠前）');
                return scanned;
              })();
            }
            rows = (await _bfScanP).filter(c => c.code === r.code);
          }
          let hit = rows.find(c => c.code === r.code && String(c.seq || '0') === String(r.seq || '0'));
          if (!hit) hit = rows.find(c => c.code === r.code);
          if (hit) {
            mergeRows([hit]);
            outcome.push(r.code + '✓');
            _bfStatus[r.code] = '✓已上轴';
          } else {
            outcome.push(r.code + '×(搜到' + rows.length + '行无匹配)');
            _bfStatus[r.code] = '×搜到' + rows.length + '行无匹配';
          }
        } catch (e) {
          outcome.push(r.code + '×(' + ((e as Error).message || String(e)) + ')');
          _bfStatus[r.code] = '×' + (String((e as Error).message || '')).slice(0, 30);
        }
      }),
    );
    if (i + 5 < need.length) await sleep(60);
  }
  console.log(TAG, '已选时间回填结果:', outcome.join(' , ') || '无');
  if (session.allCourses.length && _bfStatus && Object.keys(_bfStatus).length) console.log('');
}

/** 组件用：时间未定课的解析状态 */
export const bfStatusFor = (code: string): string => _bfStatus[code] || '';

export function resetBfBudget(): void {
  _selTried.clear();
  _bfStatus._ = '';
  _bfScanP = null;
  _selBfLogged = false;
}

export async function fetchDetail(teacherId: string, code: string): Promise<Record<string, string> | null> {
  return fetchCourseDetail(ctx(), teacherId, code);
}

export async function changeSemester(newSem: string): Promise<void> {
  session.SEM = newSem.trim();
  await store.set(K.sem, session.SEM);
  await store.set(K.staticData, null).catch(() => {});
  session.allCourses = [];
  session.candidateCourses = [];
  session.planData = [];
  session.levelMap = {};
  session.queueDataMap = {};
  clearCardExpansions();
  vol.map = {};
  Object.keys(volSession.depts).forEach(k => delete volSession.depts[k]);
  session.fetchWarn = '';
  await launch();
}

export function closeWorkbench(): void {
  session.open = false;
  clearCardExpansions();
}
