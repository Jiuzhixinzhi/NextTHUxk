// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 志愿统计状态（volMap + 检查点窗口缓存 + 院内自愈）
// ═══════════════════════════════════════════════════════════════
import type { Course, VolDatum } from '../domain/types';
import { TAG } from '../core/constants';
import { fmtTime, keyOf, normSeq } from '../core/utils';
import { K, store } from '../storage/store';
import {
  applyVolunteer,
  fetchVolCourse,
  fetchVolunteer,
  volSession,
  type VolSession,
} from '../api/volunteers';
import { volNeedsRefresh, volWindowStart } from '../update/check';

export const vol = $state({
  map: {} as Record<string, VolDatum>,
  nextSyncAt: 0,
  syncing: false,
});

let persistT: ReturnType<typeof setTimeout> | undefined;

/** 志愿缓存水合：同学期 + 同检查点窗口 → volMap/volSession.depts 直接还原 */
export function volCacheHydrate(sem: string): void {
  store.get<{ sem: string; windowStart: number; map: Record<string, VolDatum>; depts: Record<string, number> }>(K.volCache)
    .then(c => {
      if (!c || !c.map || !c.depts) return;
      if (c.sem !== sem) return;
      if (c.windowStart !== volWindowStart().getTime()) return;
      vol.map = Object.assign({}, vol.map, c.map);
      Object.assign(volSession.depts, c.depts);
      console.log(TAG, 'vol cache hydrated:', Object.keys(c.map).length, 'rows,', Object.keys(c.depts).length, 'depts（窗口', fmtTime(c.windowStart), '）');
    })
    .catch(() => {});
}

/** 志愿缓存写回（防抖 2s；窗口起点调用时刻捕获） */
export function volCachePersist(sem: string): void {
  clearTimeout(persistT);
  const win = volWindowStart().getTime();
  persistT = setTimeout(() => {
    clearTimeout(persistT);
    complete();
  }, 2000);
  function complete() {
    try {
      store.set(K.volCache, { sem, windowStart: win, map: vol.map, depts: volSession.depts });
    } catch (e) {
      console.warn(TAG, 'volCache persist:', e);
    }
  }
}

/** 志愿自动同步定时器（到检查点触发回调再重新排程） */
let syncStarted = false;
let syncT: ReturnType<typeof setTimeout> | undefined;
export function startVolAutoSync(sem: string, onSync: () => Promise<void>): void {
  if (syncStarted) return;
  syncStarted = true;
  const schedule = () => {
    const next = nextCheckpoint();
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
function nextCheckpoint(): Date {
  const cp = [8, 12, 16, 20];
  const d = new Date();
  for (const h of cp) {
    const t = new Date(d);
    t.setHours(h, 0, 0, 0);
    if (t > d) return t;
  }
  const t = new Date(d);
  t.setDate(t.getDate() + 1);
  t.setHours(cp[0]!, 0, 0, 0);
  return t;
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
      fresh: ts => !volNeedsRefresh(ts),
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
  if (Object.keys(partial).length) {
    vol.map = Object.assign({}, vol.map, partial);
    const targets = ctx.allCourses.concat(ctx.searchRows || []);
    applyVolunteer(targets, vol.map);
  }
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
    // 缺行自愈：volMap 仍缺的行对其院系定向强制重拉 + 逐课 p_kch（各 3 次预算）
    const retried = volSession.retried;
    const nk = (r: Course) => keyOf(r.code, r.seq);
    const scope = rows.concat(ctx.allCourses.filter(p => !rows.includes(p)));
    const missing = scope.filter(r => {
      if (!(r && r.code)) return false;
      const dc = volSessionDeptOf(r);
      return !!dc && !vol.map[nk(r)] && (retried[dc] || 0) < 3;
    });
    if (missing.length) {
      const mdeps = Array.from(new Set(missing.map(volSessionDeptOf)));
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
        if ((retried['k:' + r.code] || 0) >= 3) continue;
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

import { deptOfCourse } from '../api/dept';
function volSessionDeptOf(r: Course): string {
  return deptOfCourse(r);
}
