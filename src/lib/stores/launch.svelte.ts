// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 启动编排根：launch 两阶段抓取 + 子系统接线（显式序列）+
// 学期切换/工作台开关生命周期 + 横幅（更新检查唯一写者）。
// B3 自 stores/session 迁出：session 退回纯池状态/动作，编排单一归属于此。
// ═══════════════════════════════════════════════════════════════
import type { Course, Ctx, ManualEvent, PlanCourse } from '../domain/types';
import { DATA_VER, TAG } from '../core/constants';
import { K, cleanupLegacyKeys, store } from '../storage/store';
import { knoteLoad } from '../storage/knote';
import { fetchTrainingPlan } from '../api/plan';
import {
  applyLevelMap,
  fetchCandidateCourses,
  fetchCategoryAttrs,
  fetchLevelTable,
  fetchQueueData,
  fetchSelectedCourses,
} from '../api/records';
import { attachScores, ensureScores } from '../api/scores';
import { applyVolunteer } from '../api/volunteers';
import { mergeCandidateRows, applyQueueToPool } from '../domain/pool';
import { vol, volCacheHydrate, volCachePersist, volSessionReset, fetchVolForPool, startVolAutoSync, type VolApplyCtx } from './volunteer.svelte.ts';
import { probHistHydrate } from './probhist.svelte.ts';
import { showXkResult } from './toast.svelte.ts';
import { promptDialog } from './modal.svelte.ts';
import { clearCardExpansions } from './uicards.svelte.ts';
import { session, ctx, mergeRows, syncQueueAndVol } from './session.svelte.ts';
import { backfillCandidateMeta, backfillSelTimes, resetBfBudget, type SelBackfillDeps } from './backfill.svelte.ts';
import { zyCacheHydrate, resolveZyMissing } from './zy.svelte.ts';
import { markLaunchStart, emitLaunchDone } from './bus.svelte.ts';
import { checkUpdate } from '../update/check';
import { ensureIndex, tbAttach, setOnIndexChange } from '../reviews/reviews';
import { loadDrafts } from './drafts.svelte.ts';

// ─── 横幅（更新/危险版本；唯一写者=本模块的更新检查接线）────────

export const banner = $state({ kind: 'none' as 'none' | 'update' | 'danger', ver: '', url: '' });
export function setBanner(kind: 'update' | 'danger', ver?: string, url?: string): void {
  banner.kind = kind;
  if (ver) banner.ver = ver;
  if (url) banner.url = url;
}
export function clearBanner(): void {
  banner.kind = 'none';
}

// ─── 已选回填注入（backfill 不 import session，接缝在此合龙）─────

function selBackfillDeps(): SelBackfillDeps {
  return {
    ctx: () => ctx(),
    selRows: () => session.allCourses.filter(c => c.selected && !c.isCandidate),
    mergeRow: hit => {
      mergeRows([hit]);
    },
  };
}

/** 课表「重试解析」按钮入口：重置预算后再跑一轮已选回填 */
export function retrySelBackfill(): void {
  resetBfBudget();
  void backfillSelTimes(selBackfillDeps());
}

// ─── 启动编排（阶段序列：已选首屏 → 并行到货 → 后台尾部）────────

export async function launch(): Promise<void> {
  if (session.launching) {
    showXkResult({ ok: false, msg: '正在加载中，请稍候…' });
    return;
  }
  session.launching = true;
  markLaunchStart();
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
    session.manualEvents = await store.getArray<ManualEvent>(K.manualEvents);
    let sd: { ver: number; plan: PlanCourse[] } | null = (await store.get<{ ver: number; plan: PlanCourse[] }>(K.staticData)) || null;
    if (sd && sd.ver !== DATA_VER) {
      console.log(TAG, 'data version mismatch, clearing cache');
      sd = null;
      await store.set(K.staticData, null).catch(() => {});
    }
    // 坏形态自愈：plan 非数组（storage 损坏/异物写入）时清缓存重拉。
    // 历史故障：sd.ver 命中但 plan 为真值非数组 → applyLevelMap 的 (plan||[]).forEach 抛
    // 「(n||[]).forEach is not a function」，launch 整体死掉、工作台打不开。
    if (sd && !Array.isArray(sd.plan)) {
      console.warn(TAG, 'staticData.plan 形态非法，清缓存重拉:', typeof sd.plan);
      sd = null;
      await store.set(K.staticData, null).catch(() => {});
    }
    session.planData = sd?.plan || [];
    volCacheHydrate(session.SEM);
    probHistHydrate(session.SEM);
    zyCacheHydrate(session.SEM);
    console.log(TAG, 'on-demand mode: fetching selected + candidates + plan');
    // 阶段1：已选先上屏（上游 68485cd 同款：进选课列表先出已选，不等方案/目录/候补/属性）
    const selectedCourses = await fetchSelectedCourses(ctx()).catch(e => {
      console.warn(TAG, 'selected:', e);
      return [];
    });
    const pool: Course[] = selectedCourses.map(c => ({ ...c, selected: true }));
    session.allCourses = pool;
    applyLevelMap(pool, session.levelMap, session.planData);
    // 阶段2：候补/方案/等级/属性并行到货后增量并入池（已选首屏不被拖慢）
    const [candRes, planFresh, level, catAttrs] = await Promise.all([
      fetchCandidateCourses(ctx()).catch(e => {
        console.warn(TAG, 'candidates:', e);
        return { rows: [], ok: false };
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
    session.candidateCourses = candRes.rows;
    session.candidateFetchOk = candRes.ok;
    if (candRes.rows.length) {
      await backfillCandidateMeta(ctx(), candRes.rows).catch(e => console.warn(TAG, 'cand meta:', e));
    }
    mergeCandidateRows(session.allCourses, session.candidateCourses);
    session.knote = await knoteLoad().catch(e => {
      console.warn(TAG, 'knote:', e);
      return {};
    });
    applyLevelMap(session.allCourses, session.levelMap, session.planData);
    // 重开场景：志愿院系均在检查点窗口内 fresh → 后台拉取返回空，池行会一直缺 vol 字段
    // （概率标签消失）。此处先用内存/缓存 vol.map 同步回放，后台到货后再刷新。
    if (Object.keys(vol.map).length) applyVolunteer(session.allCourses, vol.map);
    // 课余量/排队 + 志愿：非阻塞（UI 先上屏，数据后到回填）
    void (async () => {
      const qResult = await fetchQueueData(ctx(), session.allCourses).catch(e => {
        console.warn(TAG, 'queue:', e);
        return { map: {}, phase: false };
      });
      session.queueDataMap = qResult.map;
      session.isQueuePhase = qResult.phase;
      if (qResult.phase) {
        applyQueueToPool(session.allCourses, session.queueDataMap);
      } else {
        try {
          await fetchVolForPoolLaunch(session.allCourses);
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
      // 缺志愿号的已选行补问（一次；confirmed 缓存命中则零弹窗）——v2 语义恢复：
      // v3 改写期 zyConfirm 不可达（refreshSelected 全调用点传 withModal=false）且缓存不水合
      void resolveZyMissing(ctx(), session.allCourses, session.isQueuePhase);
    })();
    session.knote = Object.assign({}, session.knote);
    void backfillSelTimes(selBackfillDeps());
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
    console.log(TAG, 'on-demand launch done:', session.allCourses.filter(c => c.selected).length, 'selected,', session.candidateCourses.length, 'candidates,', session.isQueuePhase ? 'queue phase' : 'browse mode');
  } catch (e) {
    showXkResult({ ok: false, msg: '启动失败：' + (e instanceof Error ? e.message : String(e)) });
  } finally {
    session.launching = false;
    emitLaunchDone();
  }
}

// ─── 志愿：launch 后台块 ─────────────────────────────────────

async function fetchVolForPoolLaunch(pool: Course[]): Promise<void> {
  const vctxAll: VolApplyCtx & Ctx = { allCourses: pool, searchRows: null, sem: session.SEM, ...ctx() };
  await fetchVolForPool(vctxAll, pool, false);
  volCachePersist(session.SEM);
}
let autoSyncArmed = false;
function startVolAutoSyncIfNeeded(): void {
  if (autoSyncArmed) return;
  autoSyncArmed = true;
  startVolAutoSync(session.SEM, async () => {
    await syncQueueAndVol();
  });
}

// ─── 生命周期：学期切换 / 工作台开关 / 统一入口 ─────────────────

/** 换学期：清空各子系统会话状态后重新启动。
 *  B3 生命周期补齐：回填预算/扫描缓存（_selTried 曾跨学期残留）与 zy 缓存
 *  （随学期隔离）一并重置。 */
export async function changeSemester(newSem: string): Promise<void> {
  session.SEM = newSem.trim();
  await store.set(K.sem, session.SEM);
  await store.set(K.staticData, null).catch(() => {});
  session.allCourses = [];
  session.candidateCourses = [];
  session.candidateFetchOk = false;
  session.planData = [];
  session.levelMap = {};
  session.queueDataMap = {};
  clearCardExpansions();
  vol.map = {};
  volSessionReset();
  resetBfBudget();
  zyCacheHydrate(session.SEM);
  session.fetchWarn = '';
  await launch();
}

export function closeWorkbench(): void {
  session.open = false;
  clearCardExpansions();
}

/** 打开工作台（launch 按钮入口）：先载草稿再启动。
 *  B3 收拢：原 main.ts bootAndLaunch 与 App.svelte openWorkbench 是两份复制序列；
 *  popup 走 `toggleWorkbench`（带翻转语义），本函数只负责「开」。
 *  launch 进行中再触发 → 统一弹「正在加载」（旧路径会中途关台，已废弃）。 */
export async function openWorkbench(): Promise<void> {
  if (session.launching) {
    showXkResult({ ok: false, msg: '正在加载中，请稍候…' });
    return;
  }
  if (!session.open) {
    await loadDrafts().catch(() => {});
    await launch();
  } else {
    session.open = true;
  }
}

/** 翻转工作台（popup 专用）：launch 中不关台只提示；未开则开、已开则关。
 *  关闭走 `closeWorkbench`（含卡片展开态清理，与顶栏关闭语义统一）。 */
export function toggleWorkbench(): void {
  if (session.launching) {
    showXkResult({ ok: false, msg: '正在加载中，请稍候…' });
    return;
  }
  if (!session.open) void openWorkbench();
  else closeWorkbench();
}
