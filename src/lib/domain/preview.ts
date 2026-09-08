// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 预览行合成（join 池行 note/time，外校课时间载体）
// ═══════════════════════════════════════════════════════════════
import type { Course, ManualEvent } from './types';
import { clockRangesOf, parseTimeSlots } from './time';
import { normSeq } from '../core/utils';

const parses = (c: Course) =>
  parseTimeSlots(c.time || '').length > 0 || clockRangesOf(c.note || c.xkTextNote || '', c.time || '').length > 0;

/** OneTHU buildRows join：已选/候补/草稿行时间解析不出 → 当场按课号借池行的
 *  note/time 合成预览行（池里有目录行立即能用；不再依赖回填时序）。
 *  输出按 keyOf 去重（防池内 '01'/'1' 双写法重复行）。 */
export function previewJoinRows(rows: Course[], pool: Course[], knote: Record<string, { note: string; time: string }>): Course[] {
  const catByCode = new Map<string, Course>();
  const fallbackByCode = new Map<string, Course>();
  for (const c of pool) {
    if (parses(c)) {
      if (!catByCode.has(c.code)) catByCode.set(c.code, c);
    } else if ((c.note || c.xkTextNote) && !fallbackByCode.has(c.code)) {
      fallbackByCode.set(c.code, c);
    }
  }
  const seen = new Set<string>();
  const out: Course[] = [];
  for (const s of rows) {
    if (seen.has(s.code + '_' + normSeq(s.seq))) continue;
    seen.add(s.code + '_' + normSeq(s.seq));
    if (parses(s)) {
      out.push(s);
      continue;
    }
    const c0 = catByCode.get(s.code) || fallbackByCode.get(s.code);
    const knoteHit =
      c0 ||
      (knote[s.code + '_' + (s.seq || '0')] as Course | undefined) ||
      (Object.keys(knote)
        .map(k => knote[k] && k.indexOf(s.code + '_') === 0 ? (knote[k] as Course) : null)
        .filter(Boolean)[0] as Course | undefined);
    if (!knoteHit) {
      out.push(s);
      continue;
    }
    out.push(
      Object.assign({}, s, {
        time: parseTimeSlots(s.time || '').length ? s.time : (knoteHit.time || s.time || ''),
        note: knoteHit.note || s.note || '',
        xkTextNote: (knoteHit.note || s.xkTextNote || '') as string,
      }),
    );
  }
  return out;
}

/** 课表预览块元数据（概率色/排队/自定义着色——与卡片同源语义） */
export interface BlockMeta {
  color: string;
  label: string;
  bg: string;
}

export function previewBlockMeta(
  c: Course | ManualEvent,
  isQueuePhase: boolean,
  previewIsSelected: boolean,
  queueDataMap: Record<string, { qRemaining: number; qQueue: number; qCapacity: number }>,
  cand: Course | undefined,
  prob: { color: string; label: string; bg: string } | null,
): BlockMeta {
  const me = c as ManualEvent;
  if (me.manual) return { color: '#8b5cf6', label: '自定义', bg: 'rgba(139,92,246,.14)' };
  const cc = c as Course;
  if (cc.isCandidate && cand?.myPos) return { color: '#ff9f1a', label: '排队第' + cand.myPos + '/' + (cand.queueTotal || 0) + '人', bg: 'rgba(255,159,26,.14)' };
  if (cc.isCandidate) return { color: '#ff9f1a', label: '候选中', bg: 'rgba(255,159,26,.14)' };
  if (isQueuePhase) {
    if (previewIsSelected) return { color: '#07c160', label: '已选', bg: 'rgba(7,193,96,.14)' };
    const qd = queueDataMap[String(cc.code) + '_' + String(parseInt(String(cc.seq || '0'), 10) || 0)];
    if (qd) {
      if (qd.qRemaining > 0) return { color: '#07c160', label: '余' + qd.qRemaining, bg: 'rgba(7,193,96,.14)' };
      if (qd.qQueue > 0) return { color: '#ff9f1a', label: '排队' + qd.qQueue + '人', bg: 'rgba(255,159,26,.14)' };
      return { color: '#ee4d4d', label: '已满', bg: 'rgba(238,77,77,.14)' };
    }
    return { color: '', label: '', bg: '' };
  }
  if (prob) return { color: prob.color, label: prob.label, bg: prob.bg };
  return { color: '', label: '', bg: '' };
}
