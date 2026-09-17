// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课程池合并（纯函数）：搜索行入池 · 队列余量回填 · 候补标记
// 四套复制粘贴的合并习语收拢到此：池内行空字段回填、容量/余量刷新、
// 未解析时间的已选/候补行借新行时间——策略改动只需动这里，且可 vitest 直测。
// ═══════════════════════════════════════════════════════════════
import type { Course, QueueDatum } from './types';
import { keyOf } from '../core/utils';
import { clockRangesOf, parseTimeSlots } from './time';
import { matchPoolRow } from './match';

/** 时间可解析（大节或文字说明钟点任一可用）——池合并与预览 join 共用判定 */
export const hasParsedTime = (c: Course): boolean =>
  parseTimeSlots(c.time || '').length > 0 || clockRangesOf(c.note || c.xkTextNote || '', c.time || '').length > 0;

export interface PoolMergeResult {
  /** 新入池行数 */
  added: number;
  /** 字段被回填/刷新的次数（同一行多处改动累计） */
  filled: number;
}

/**
 * 合并服务端搜索行入池（原地）：
 * - 新课班入池；既有行回填空缺字段（note/time/teacher/credits/department/xkTextNote）
 * - 容量/余量刷新：r.capacity>0 才动（页签 0/0 占位不覆盖）；余量含 0（「余 0=已满」是信息）
 * - 借时间：本批可解析的行把 note/time 借给池内同课号、时间未解析的已选/候补行，
 *   且必须按课序/教师匹配到同一课班（用户实锤「形策跳转左边看得见余量、右边暂存不显示」；
 *   后又实锤一课号多班盲借首行 → 已选行时间张冠李戴，故借源走 matchPoolRow，宁缺勿错）
 * - onParsedRow：本批每个时间可解析的行回调一次（调用方写 knote 时间记忆）
 */
export function mergePoolRows(pool: Course[], rows: Course[], onParsedRow?: (row: Course) => void): PoolMergeResult {
  if (!rows || !rows.length) return { added: 0, filled: 0 };
  const byKey = new Map(pool.map(c => [keyOf(c.code, c.seq), c]));
  let added = 0;
  let filled = 0;
  // 借入方（已选/候补且时间未解析）先登记；借源（本批可解析行）按课号收集，循环后统一匹配
  const borrowers = pool.filter(c => (c.selected || c.isCandidate) && !hasParsedTime(c));
  const donorsByCode = new Map<string, Course[]>();
  for (const r of rows) {
    const k = keyOf(r.code, r.seq);
    const ex = byKey.get(k);
    if (!ex) {
      pool.push(r);
      byKey.set(k, r);
      added++;
    } else {
      const before = ex.note + '|' + ex.time;
      if (!ex.note && r.note) ex.note = r.note;
      if (!ex.time && r.time) ex.time = r.time;
      else if (!hasParsedTime(ex) && hasParsedTime(r)) ex.time = r.time || ex.time;
      if (!ex.teacher && r.teacher) ex.teacher = r.teacher;
      if (!ex.credits && r.credits) ex.credits = r.credits;
      if (!ex.department && r.department) ex.department = r.department;
      if (!ex.xkTextNote && r.xkTextNote) ex.xkTextNote = r.xkTextNote;
      // 容量/余量刷新（上游 f0a1090 同款）：旧池行残值（列漂时代容量 0）吃不到新行真值
      const rCap = r.capacity || 0;
      const rRem = r.remaining ?? 0;
      if (rCap > 0 && (ex.capacity !== rCap || ex.remaining !== rRem)) {
        ex.capacity = rCap;
        ex.remaining = rRem;
        ex.available = rRem > 0;
        filled++;
      }
      if (before !== ex.note + '|' + ex.time) filled++;
    }
    if (hasParsedTime(r)) {
      onParsedRow?.(r);
      const donors = donorsByCode.get(r.code);
      if (donors) donors.push(r);
      else donorsByCode.set(r.code, [r]);
    }
  }
  // 借时间（循环后统一）：同课号多班只借同课序/同师的行，杜绝取首行张冠李戴
  for (const b of borrowers) {
    if (hasParsedTime(b)) continue;
    const donor = matchPoolRow(donorsByCode.get(b.code) || [], b.seq, b.teacher);
    if (!donor) continue;
    if (!b.note && donor.note) {
      b.note = donor.note;
      filled++;
    }
    if (!hasParsedTime(b) && donor.time) {
      b.time = donor.time;
      filled++;
    }
    if (!b.xkTextNote && (donor.note || donor.xkTextNote)) {
      b.xkTextNote = donor.note || donor.xkTextNote;
      filled++;
    }
  }
  return { added, filled };
}

/** 队列余量回填（课余量阶段）：available/remaining/capacity 三字段口径唯一来源 */
export function applyQueueToPool(pool: Course[], queueDataMap: Record<string, QueueDatum>): void {
  for (const c of pool) {
    const q = queueDataMap[keyOf(c.code, c.seq)];
    if (!q) continue;
    c.available = q.qRemaining > 0;
    if (q.qRemaining > 0) c.remaining = q.qRemaining;
    c.capacity = q.qCapacity;
  }
}

/** 候补标记：按候补名单重写池内 isCandidate（权威名单外的行一律清除） */
export function markCandidates(pool: Course[], candidates: Course[]): void {
  const keys = new Set(candidates.map(c => keyOf(c.code, c.seq)));
  for (const c of pool) c.isCandidate = keys.has(keyOf(c.code, c.seq));
}

/** 候补行并入池（不在池中的候补课班补一条 isCandidate 行）；返回新增行数 */
export function mergeCandidateRows(pool: Course[], candidates: Course[]): number {
  let added = 0;
  const seen = new Set(pool.map(c => keyOf(c.code, c.seq)));
  for (const c of candidates) {
    const k = keyOf(c.code, c.seq);
    if (seen.has(k)) continue;
    pool.push({ ...c, isCandidate: true });
    seen.add(k);
    added++;
  }
  return added;
}
