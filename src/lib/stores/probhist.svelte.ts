// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 概率趋势历史状态（窗口快照聚合 + 变化才延迟写盘）
// 挂接在志愿到货路径（volCachePersist 内），同窗口幂等：窗口内多次
// 到货只覆盖同窗点；切学期清空内存、下次写盘以新 sem 覆盖旧历史。
// ═══════════════════════════════════════════════════════════════
import type { VolDatum } from '../domain/types';
import { TAG } from '../core/constants';
import { mergeWindow, snapshotVolMap, type VolHistMap } from '../domain/probhist';
import { K, store } from '../storage/store';
import { volWindowStart } from '../update/check';

export const probHist = $state({
  sem: '',
  map: {} as VolHistMap,
  ready: false,
});

/** 启动水合：先清空（切学期防串），存储 sem 匹配才回填 */
export function probHistHydrate(sem: string): void {
  probHist.map = {};
  probHist.sem = sem;
  probHist.ready = false;
  store
    .get<{ sem: string; map: VolHistMap }>(K.probHist)
    .then(c => {
      if (!c || !c.map || c.sem !== sem) return;
      probHist.map = c.map;
      console.log(TAG, 'prob history hydrated:', Object.keys(c.map).length, 'courses');
    })
    .catch(() => {})
    .finally(() => {
      probHist.ready = true;
    });
}

let persistT: ReturnType<typeof setTimeout> | undefined;

/** 志愿到货挂点：当前快照并入历史（t=窗口起点；无变化不写盘） */
export function recordVolWindow(sem: string, volMap: Record<string, VolDatum>): void {
  if (!sem || !volMap || !Object.keys(volMap).length) return;
  const incoming = snapshotVolMap(volMap, volWindowStart().getTime());
  if (!mergeWindow(probHist.map, incoming)) return;
  clearTimeout(persistT);
  const sem0 = sem;
  persistT = setTimeout(() => {
    clearTimeout(persistT);
    try {
      store.set(K.probHist, { sem: sem0, map: JSON.parse(JSON.stringify(probHist.map)) });
    } catch (e) {
      console.warn(TAG, 'probHist persist:', e);
    }
  }, 2000);
}
