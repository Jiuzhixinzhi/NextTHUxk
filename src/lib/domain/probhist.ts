// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 概率趋势历史（志愿统计窗口快照，纯函数）
// 服务端志愿统计按检查点窗口（8/12/16/20 点）刷新，到货的 VolDatum
// 原始值按「课班 → 时间点序列」留存：任意 (类型,志愿) 的概率均可由
// calcProb 事后重算，供级联链节点查看中签率变化趋势。
// ═══════════════════════════════════════════════════════════════
import type { Course, Flag, ProbResult, VolDatum } from './types';
import { calcProb } from './probability';
import { keyOf } from '../core/utils';

/** 单窗口志愿快照（t = 检查点窗口起点 ms；缺位字段存空串/0） */
export interface VolPoint {
  t: number;
  cap: number;
  vr: string;
  vx: string;
  vo: string;
  vs: string;
}

/** 课班键（keyOf 归一）→ 按 t 升序的点序列（同窗口最多一点，后到覆盖） */
export type VolHistMap = Record<string, VolPoint[]>;

/** 保留窗口数上限：60 窗口 ≈ 15 天（unlimitedStorage 下防无限增长） */
export const MAX_HIST_WINDOWS = 60;

/** 当前志愿 map → 单窗口快照 map（key 归一；无志愿状态的课不倒进历史） */
export function snapshotVolMap(volMap: Record<string, VolDatum>, t: number): VolHistMap {
  const out: VolHistMap = {};
  for (const k of Object.keys(volMap)) {
    const v = volMap[k]!;
    if (!v || !v.code) continue;
    const has = Number(v.applied) || Number(v.capacity) || v.volRequired || v.volElective || v.volOptional || v.volSports;
    if (!has) continue;
    out[keyOf(v.code, v.seq)] = [
      { t, cap: Number(v.capacity) || 0, vr: v.volRequired || '', vx: v.volElective || '', vo: v.volOptional || '', vs: v.volSports || '' },
    ];
  }
  return out;
}

function pointsEq(a: VolPoint, b: VolPoint): boolean {
  return a.t === b.t && a.cap === b.cap && a.vr === b.vr && a.vx === b.vx && a.vo === b.vo && a.vs === b.vs;
}

/** 窗口快照并入历史：按 t 排序插入，同窗口替换（窗口内后到修正），新窗口补位；超上限截断。返回是否有变化 */
export function mergeWindow(hist: VolHistMap, incoming: VolHistMap, max = MAX_HIST_WINDOWS): boolean {
  let changed = false;
  for (const k of Object.keys(incoming)) {
    const p = incoming[k]![0]!;
    const ex = hist[k] || (hist[k] = []);
    let at = ex.length;
    for (let i = 0; i < ex.length; i++) {
      if (ex[i]!.t >= p.t) {
        at = i;
        break;
      }
    }
    const exAt = ex[at];
    if (exAt && exAt.t === p.t) {
      if (pointsEq(exAt, p)) continue;
      ex[at] = p;
      changed = true;
    } else {
      ex.splice(at, 0, p);
      changed = true;
    }
    if (ex.length > max) {
      ex.splice(0, ex.length - max);
      changed = true;
    }
  }
  return changed;
}

/** 快照点 → 该 (类型,志愿) 概率（构造伪课程委托 calcProb，口径与卡片一致） */
export function probAt(p: VolPoint, flag: Flag, zy: number): ProbResult {
  const pseudo: Course = {
    code: '',
    seq: '0',
    name: '',
    volCapacity: p.cap,
    volRequired: p.vr,
    volElective: p.vx,
    volOptional: p.vo,
    volSports: p.vs,
  };
  return calcProb(pseudo, flag, zy);
}

/** 概率序列：仅保留有效点（prob>=0），x=窗口时间 */
export function probSeries(points: VolPoint[] | undefined, flag: Flag, zy: number): { t: number; prob: number }[] {
  const out: { t: number; prob: number }[] = [];
  for (const p of points || []) {
    const r = probAt(p, flag, zy);
    if (r.prob >= 0) out.push({ t: p.t, prob: r.prob });
  }
  return out;
}

/** 相对上一有效窗口的概率差（百分点，正=变好）；历史不足 2 点 → null */
export function trendDelta(points: VolPoint[] | undefined, flag: Flag, zy: number): number | null {
  const s = probSeries(points, flag, zy);
  if (s.length < 2) return null;
  return Math.round((s[s.length - 1]!.prob - s[s.length - 2]!.prob) * 100);
}

/** 折线 SVG 坐标串（x 按时间比例，跨窗口缺口不失真；<2 点 → null；y 域可传 [yMin,yMax] 以放大波动） */
export function sparkPath(
  series: { t: number; prob: number }[],
  w: number,
  h: number,
  pad = 4,
  yMin = 0,
  yMax = 1,
): string | null {
  if (series.length < 2 || w < pad * 2 || h < pad * 2) return null;
  const t0 = series[0]!.t;
  const span = Math.max(1, series[series.length - 1]!.t - t0);
  const ySpan = Math.max(1e-9, yMax - yMin);
  const pts = series.map(s => {
    const x = pad + ((s.t - t0) / span) * (w - pad * 2);
    const y = h - pad - ((s.prob - yMin) / ySpan) * (h - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  return pts.join(' ');
}

/** 动态 y 域：按 min/max ±15% padding 缩放（夹紧 [0,1]）；扁平序列（差<1 百分点）退化为值 ±5% 区间防炸域 */
export function probYDomain(series: { t: number; prob: number }[], padRatio = 0.15, minPad = 0.02): [number, number] {
  if (!series.length) return [0, 1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    if (s.prob < lo) lo = s.prob;
    if (s.prob > hi) hi = s.prob;
  }
  if (hi - lo < 0.01) {
    const v = Math.min(1, Math.max(0, (lo + hi) / 2));
    return [Math.max(0, v - 0.05), Math.min(1, v + 0.05)];
  }
  const pad = Math.max((hi - lo) * padRatio, minPad);
  return [Math.max(0, lo - pad), Math.min(1, hi + pad)];
}
