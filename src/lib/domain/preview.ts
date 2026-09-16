// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 预览行合成（join 池行 note/time，外校课时间载体）
// ═══════════════════════════════════════════════════════════════
import type { Course, ManualEvent } from './types';
import { parseTimeSlots } from './time';
import { hasParsedTime } from './pool';
import { keyOf } from '../core/utils';
import { matchPoolRow } from './match';
import { QUEUE_CAP_STYLE, queueCapLevel } from './probability';

const parses = hasParsedTime;

/** OneTHU buildRows join：已选/候补/草稿行时间解析不出 → 当场按课号借池行的
 *  note/time 合成预览行（池里有目录行立即能用；不再依赖回填时序）。
 *  借源走三段匹配（归一课序 → 同课同师 → 首行兜底）——同课号多班直接借首行会
 *  让不同时间的课在预览课表挤进同一格（上游 d28bdb5 同款）。
 *  输出按 keyOf 去重（防池内 '01'/'1' 双写法重复行）。 */
export function previewJoinRows(rows: Course[], pool: Course[], knote: Record<string, { note: string; time: string }>): Course[] {
  const parseableByCode = new Map<string, Course[]>();
  const anyByCode = new Map<string, Course[]>();
  for (const c of pool) {
    if (!c.code) continue;
    const any = anyByCode.get(c.code) || [];
    any.push(c);
    anyByCode.set(c.code, any);
    if (parses(c)) {
      const pa = parseableByCode.get(c.code) || [];
      pa.push(c);
      parseableByCode.set(c.code, pa);
    }
  }
  const seen = new Set<string>();
  const out: Course[] = [];
  for (const s of rows) {
    if (seen.has(keyOf(s.code, s.seq))) continue;
    seen.add(keyOf(s.code, s.seq));
    if (parses(s)) {
      out.push(s);
      continue;
    }
    // 只借同课号行：优先可解析行（能提供时间），走三段匹配挑对班
    const poolRows = parseableByCode.get(s.code) || anyByCode.get(s.code) || [];
    let hit: Course | undefined = matchPoolRow(poolRows, s.seq, s.teacher);
    if (!hit) {
      const knoteKey = Object.keys(knote).find(k => k.indexOf(s.code + '_') === 0);
      hit = (knote[keyOf(s.code, s.seq)] as Course | undefined) || (knoteKey ? (knote[knoteKey] as Course | undefined) : undefined);
    }
    if (!hit) {
      out.push(s);
      continue;
    }
    out.push(
      Object.assign({}, s, {
        time: parseTimeSlots(s.time || '').length ? s.time : (hit.time || s.time || ''),
        note: hit.note || s.note || '',
        xkTextNote: (hit.note || s.xkTextNote || '') as string,
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
  isSelected: boolean,
  isQueued: boolean,
  queueDataMap: Record<string, { qRemaining: number; qQueue: number; qCapacity: number }>,
  cand: Course | undefined,
  prob: { color: string; label: string; bg: string } | null,
): BlockMeta {
  const me = c as ManualEvent;
  if (me.manual) return { color: '#8b5cf6', label: '自定义', bg: 'rgba(139,92,246,.14)' };
  const cc = c as Course;
  // 已选（正选）优先于余量/排队/已满：余量仅作退路提醒，草稿视图的已选课不再标已满（用户报）
  // 注意：判定必须按「行」而非视图——「当前已选」视图含候补行，不能用视图标志一刀切
  if (isQueuePhase && isSelected) return { color: '#07c160', label: '已选', bg: 'rgba(7,193,96,.14)' };
  if (isQueued && cand?.myPos) return { color: '#ff9f1a', label: '排队第' + cand.myPos + '/' + (cand.queueTotal || 0) + '人', bg: 'rgba(255,159,26,.14)' };
  if (isQueued) return { color: '#ff9f1a', label: '候选中', bg: 'rgba(255,159,26,.14)' };
  if (isQueuePhase) {
    const qd = queueDataMap[keyOf(cc.code, cc.seq)];
    if (qd) {
      const lv = queueCapLevel(qd.qRemaining, qd.qQueue);
      const st = QUEUE_CAP_STYLE[lv];
      const label = lv === 'ok' ? '余' + qd.qRemaining : lv === 'queued' ? '排队' + qd.qQueue + '人' : '已满';
      return { color: st.color, label, bg: st.bg };
    }
    return { color: '', label: '', bg: '' };
  }
  if (prob) return { color: prob.color, label: prob.label, bg: prob.bg };
  return { color: '', label: '', bg: '' };
}
