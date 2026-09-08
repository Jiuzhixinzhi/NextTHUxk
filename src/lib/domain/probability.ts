// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 中签概率模型 + 学分中签模拟（纯函数）
// ═══════════════════════════════════════════════════════════════
import type { Course, CreditSimItem, Flag, ProbResult, QueueDatum } from './types';
import { allowedFlags, baseFlag, flagName, isSportsCourse } from './flags';
import { normSeq } from '../core/utils';

export const fmtVol = (v: string | undefined | null): string => {
  if (!v) return '';
  const priMatch = v.match(/^\((\d+)\)/);
  const pri = priMatch ? parseInt(priMatch[1]!) : 0;
  const cleaned = v.replace(/^\(\d+\)/, '');
  const parts = cleaned.split(',').map(n => parseInt(n) || 0);
  if (parts.every(n => n === 0) && !pri) return '';
  let s = parts.join('/');
  if (pri) s = '优先' + pri + '/' + s;
  return s;
};

/** 占用对（已报/容量）：预选只信志愿统计；课余量阶段用容量-余量（实时） */
export function occupancyOf(c: Course, isQueuePhase: boolean): { applied: number; cap: number } {
  const cap = Number(c.capacity) || 0;
  const rem = c.remaining;
  if (!isQueuePhase) {
    if (Number(c.volCapacity) > 0 && c.volApplied != null) {
      return { applied: Number(c.volApplied) || 0, cap: Number(c.volCapacity) };
    }
  }
  if (cap > 0 && rem !== undefined && rem !== null && Number(Number(rem)) >= 0) {
    return { applied: Math.max(0, cap - Number(rem)), cap };
  }
  return { applied: Number(c.volApplied) || 0, cap: Number(c.volCapacity) || cap || 0 };
}

/** 课余量容量状态（已选 · 余量 · 排队）：统一口径，外显三数，「容量」只留提示用 */
export interface CapacityStatus {
  cap: number; // 容量（占比/提示用）
  used: number; // 已选 = 容量 - 余量
  rem: number | null; // 余量（未知 null）
  queue: number; // 候补排队人数
  pct: number; // 填充百分比 0-100（used/cap）
}

export function capacityStatus(c: Course, q: QueueDatum | undefined): CapacityStatus | null {
  const cap = (q && q.qCapacity) || Number(c.capacity) || 0;
  if (!cap) return null;
  const rem = q ? q.qRemaining : c.remaining != null ? Number(c.remaining) : null;
  const queue = q ? q.qQueue : 0;
  const used = rem != null && Number(rem) >= 0 ? Math.min(Math.max(0, cap - Number(rem)), cap) : Math.max(0, Number(c.volApplied) || 0);
  return { cap, used, rem: rem != null ? Math.max(0, Number(rem)) : null, queue, pct: Math.min((used / cap) * 100, 100) };
}

/** 上批已选（锁定）：搜索页 容量-余量；数据不齐/越界（如队列期余位被覆盖）返回 null */
export function lockedOf(c: Course): { locked: number; rem: number; cap: number } | null {
  const cap = Number(parseInt(String(c.capacity ?? 0), 10)) || 0;
  const rem = c.remaining;
  if (!cap || rem == null || Number(rem) < 0 || Number(rem) > cap) return null;
  return { locked: cap - Number(rem), rem: Number(rem), cap };
}

/** 预选级联拆解：池=统计页容量（本批可分配，兜底搜索页容量）；已选=上批锁定+本批优先 */
export interface CascadeStatus {
  pool: number; // 本批级联池
  cap: number; // 总容量（搜索页，仅显示/分母用）
  locked: number | null; // 上批已选（搜索页 容量-余量；缺数据 null）
  prior: number; // 优先于我的本批报名
  peers: number; // 同志愿报名
  seats: number; // 可争位 = pool - prior
  hasVol: boolean; // 本类型志愿串齐备（false → 组件回退搜索页裸数据）
}

export function cascadeOf(course: Course, flag: Flag, zy: number): CascadeStatus | null {
  const pool = Number(parseInt(String(course.volCapacity ?? course.capacity ?? 0), 10)) || 0;
  if (!pool) return null;
  const lo = lockedOf(course);
  const zyIdx = zy - 1;
  let prior = 0;
  let peers = 0;
  let hasVol = false;
  if (flag === 'ty') {
    const vols = parseVolArr(course.volSports);
    if (vols) {
      hasVol = true;
      for (let i = 0; i < zyIdx; i++) prior += vols[i]!;
      peers = vols[zyIdx]!;
    }
  } else {
    const bxV = parseVolArr(course.volRequired);
    const xxV = parseVolArr(course.volElective);
    const rxV = parseVolArr(course.volOptional);
    const sumAll = (v: (number[] & { priority?: number }) | null) => (v ? v[0]! + v[1]! + v[2]! + (v.priority || 0) : 0);
    if (bxV) {
      if (flag === 'bx') {
        hasVol = true;
        for (let i = 0; i < zyIdx; i++) prior += bxV[i]!;
        peers = bxV[zyIdx]!;
      } else {
        prior += sumAll(bxV);
      }
    }
    if (!hasVol && xxV) {
      if (flag === 'xx') {
        hasVol = true;
        for (let i = 0; i < zyIdx; i++) prior += xxV[i]!;
        peers = xxV[zyIdx]!;
      } else {
        prior += sumAll(xxV);
      }
    }
    if (!hasVol && rxV) {
      prior += rxV.priority || 0;
      if (flag === 'rx') {
        hasVol = true;
        for (let i = 0; i < zyIdx; i++) prior += rxV[i]!;
        peers = rxV[zyIdx]!;
      } else {
        prior += sumAll(rxV);
      }
    }
  }
  return { pool, cap: (lo && lo.cap) || 0, locked: lo ? lo.locked : null, prior, peers, seats: Math.max(0, pool - prior), hasVol };
}

export interface VolColor {
  level: 'easy' | 'medium' | 'hard' | 'unknown';
  color: string;
  bg: string;
  pct: number;
}

export function volColor(course: Course, isQueuePhase: boolean): VolColor {
  const occ = occupancyOf(course, isQueuePhase);
  const cap = occ.cap;
  const applied = occ.applied;
  if (!cap || cap === 0) return { level: 'unknown', color: '#9aa1ac', bg: 'rgba(154,161,172,.08)', pct: 0 };
  const ratio = applied / cap;
  if (ratio <= 0.8) return { level: 'easy', color: '#07c160', bg: 'rgba(7,193,96,.1)', pct: Math.min(ratio * 100, 100) };
  if (ratio <= 1.2) return { level: 'medium', color: '#ff9f1a', bg: 'rgba(255,159,26,.1)', pct: Math.min(ratio * 100, 100) };
  return { level: 'hard', color: '#ee4d4d', bg: 'rgba(238,77,77,.1)', pct: Math.min(ratio * 100, 100) };
}

/** 志愿串 → [v1,v2,v3]（右对齐补 0；纯优先 (N) → 全 0 + priority） */
export function parseVolArr(s: string | undefined | null): (number[] & { priority?: number }) | null {
  if (!s) return null;
  const str = String(s);
  const priMatch = str.match(/^\((\d+)\)/);
  const pri = priMatch ? parseInt(priMatch[1]!) : 0;
  const cleaned = str.replace(/^\(\d+\)/, '').trim();
  const nums = cleaned ? cleaned.match(/\d+/g) : null;
  if (!nums || !nums.length) {
    return pri > 0 ? Object.assign([0, 0, 0], { priority: pri }) : null;
  }
  const vals = nums.map(n => parseInt(n, 10) || 0);
  const arr: number[] & { priority?: number } = [0, 0, 0];
  const base = 3 - Math.min(3, vals.length);
  for (let i = 0; i < Math.min(3, vals.length); i++) arr[base + i] = vals[i]!;
  arr.priority = pri;
  return arr;
}

export function probResult(rem: number, applicants: number): ProbResult {
  if (!Number.isFinite(rem) || !Number.isFinite(applicants)) {
    return { prob: -1, label: '无数据', percentLabel: '无数据', ratioLabel: '无数据', color: '#9aa1ac' };
  }
  const remShown = Math.max(0, Math.round(rem));
  const applicantsShown = Math.max(0, Math.round(applicants));
  if (rem <= 0) return { prob: 0, label: '0%', percentLabel: '0%', ratioLabel: applicantsShown + '/' + remShown, color: '#ee4d4d' };
  const prob = applicants === 0 ? 1 : Math.min(1, rem / applicants);
  if (!Number.isFinite(prob)) return { prob: -1, label: '无数据', percentLabel: '无数据', ratioLabel: '无数据', color: '#9aa1ac' };
  let color: string;
  if (prob >= 0.8) color = '#07c160';
  else if (prob >= 0.5) color = '#ff9f1a';
  else color = '#ee4d4d';
  const percentLabel = Math.round(prob * 100) + '%';
  const ratioLabel = applicantsShown + '/' + remShown;
  return { prob, label: percentLabel, percentLabel, ratioLabel, color };
}

/** 「课班 × 课程类型 × 志愿」中签率（志愿级联；拆解口径见 cascadeOf，行为同旧版） */
export function calcProb(course: Course, flag: Flag, zy: number): ProbResult {
  const cs = cascadeOf(course, flag, zy);
  if (!cs || !cs.hasVol) return { prob: -1, label: '无数据', color: '#9aa1ac' };
  return probResult(cs.seats, cs.peers);
}

export const probBg = (color: string): string => {
  if (color === '#07c160') return 'rgba(7,193,96,.14)';
  if (color === '#ff9f1a') return 'rgba(255,159,26,.14)';
  if (color === '#ee4d4d') return 'rgba(238,77,77,.14)';
  return 'rgba(154,161,172,.12)';
};

/** 当前选法概率元数据（组件用；渲染交给模板） */
export function currentProbMeta(course: Course, flag: Flag, zy: number): ProbResult & { flagLabel: string; bg: string; zy: number } {
  const p = calcProb(course, flag, zy);
  return { ...p, zy, flagLabel: flagName(flag), bg: probBg(p.color) };
}

/** 概率网格数据（3×3 全显；体育单行）——纯数据，渲染交给组件 */
export function probGridData(course: Course): { flag: Flag; cells: (ProbResult & { zy: number })[] }[] {
  const aFlags = isSportsCourse(course) ? (['ty'] as Flag[]) : (['bx', 'xx', 'rx'] as Flag[]);
  return aFlags.map(f => ({
    flag: f,
    cells: [1, 2, 3].map(z => {
      const p = calcProb(course, f, z);
      return { ...p, zy: z };
    }),
  }));
}

/** 学分中签模拟条目（prob=null 表示实时取不到，由用户手动填） */
export function creditSimItems(
  courses: Course[],
  ctx: {
    isQueuePhase: boolean;
    queueDataMap: Record<string, { qRemaining: number } | undefined>;
    courseLookup: (code: string, seq: string) => Course | undefined;
  },
): CreditSimItem[] {
  const items: CreditSimItem[] = [];
  courses.forEach(c => {
    if (!(Number(c.credits) > 0)) return;
    let prob: number | null = null;
    const ac = ctx.courseLookup(c.code, c.seq);
    if (ctx.isQueuePhase) {
      const qd = ctx.queueDataMap[c.code + '_' + normSeq(c.seq)];
      if (qd && Number(qd.qRemaining) > 0) prob = 1;
    } else if (ac && c.flag && c.zy) {
      const p = calcProb(ac, c.flag, c.zy);
      if (p && p.prob >= 0) prob = p.prob;
    }
    items.push({
      name: c.name || c.code || '',
      credits: Math.round(Number(c.credits) || 0),
      flag: c.flag,
      zy: c.zy,
      liveProb: prob === null ? null : Math.round(prob * 100) / 100,
      prob: prob === null ? null : Math.round(prob * 100) / 100,
    });
  });
  return items;
}

/** 精确分布（非蒙特卡洛）：各课中签独立时，总学分分布 = 伯努利卷积 */
export function creditDist(items: CreditSimItem[]): { points: { credits: number; prob: number }[]; expected: number; mode: number; total: number } {
  const list = items.filter(it => it && it.credits > 0 && Number.isFinite(it.prob) && (it.prob ?? -1) >= 0 && (it.prob ?? 2) <= 1);
  let total = 0;
  list.forEach(it => (total += it.credits));
  const dist = new Float64Array(total + 1);
  dist[0] = 1;
  let curMax = 0;
  for (const it of list) {
    const p = it.prob!,
      q = 1 - p,
      cr = it.credits;
    for (let s = curMax; s >= 0; s--) {
      const v = dist[s]!;
      if (!v) continue;
      dist[s] = v * q;
      dist[s + cr] = (dist[s + cr] ?? 0) + v * p;
    }
    curMax += cr;
  }
  const points: { credits: number; prob: number }[] = [];
  let expected = 0,
    mode = 0,
    modeP = -1;
  for (let s = 0; s <= total; s++) {
    const p = dist[s]!;
    if (!(p > 0)) continue;
    if (p > modeP) {
      modeP = p;
      mode = s;
    }
    expected += s * p;
    points.push({ credits: s, prob: p });
  }
  return { points, expected, mode, total };
}
