// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 冲突检测（区间重叠制，OneTHU 同款语义）
// 课程大节 → 钟点区间，外校课走文字说明钟点，自定义占用直接用钟点区间；
// 跨边界部分重叠、周次不相交（1-8 周 vs 9-16 周、单周 vs 双周）均能正确判定。
// ═══════════════════════════════════════════════════════════════
import type { Course, ManualEvent } from './types';
import { DAY_NAMES, spansOf, weeksOverlap, type TimeSpan } from './time';
import { keyOf } from '../core/utils';

export interface Conflict {
  day: string;
  slot: string;
  a: string;
  b: string;
}

/** 唯一重叠判据（检测与预览共用）：同星期 + 钟点区间相交 + 周次占用相交 */
export function spansIntersect(a: TimeSpan, b: TimeSpan): boolean {
  return a.dayN === b.dayN && a.begin < b.end && b.begin < a.end && weeksOverlap(a.occ, b.occ);
}

export function detectConflicts(courses: (Course | ManualEvent)[], manualEvents: ManualEvent[]): Conflict[] {
  const spans: { span: TimeSpan; name: string }[] = [];
  const conflicts: Conflict[] = [];
  for (const c of courses.concat(manualEvents)) {
    for (const span of spansOf(c)) {
      for (const s of spans) {
        if (spansIntersect(s.span, span)) conflicts.push({ day: DAY_NAMES[span.dayN - 1]!, slot: span.when, a: s.name, b: c.name });
      }
      spans.push({ span, name: c.name });
    }
  }
  return conflicts;
}

// ─── 预览冲突（草稿/已选/候补行 + 自定义占用的时段表）───────────

/** 预览时段：带行身份（keyOf 归一，自排除不受 '01'/'1' 拼写影响）的占用区间 */
export interface PreviewSpan extends TimeSpan {
  key: string;
  name: string;
}

/** 行 → 时段表（已选/候补/草稿 + 自定义占用） */
export function buildPreviewSpans(previewRows: (Course | ManualEvent)[], manualEvents: ManualEvent[]): PreviewSpan[] {
  const out: PreviewSpan[] = [];
  for (const pc of previewRows.concat(manualEvents)) {
    const key = keyOf(pc.code, pc.seq);
    const name = pc.name || pc.code;
    for (const span of spansOf(pc)) out.push({ ...span, key, name });
  }
  return out;
}

export function conflictsWithPreview(course: Course, spans: PreviewSpan[]): { name: string; day: string; slot: string }[] {
  if (!spans.length) return [];
  const selfKey = keyOf(course.code, course.seq);
  const conflicts: { name: string; day: string; slot: string }[] = [];
  const seen = new Set<string>();
  for (const mine of spansOf(course)) {
    for (const h of spans) {
      if (h.key === selfKey) continue;
      if (!spansIntersect(mine, h)) continue;
      const k = h.name + '|' + h.dayN + '|' + h.when;
      if (seen.has(k)) continue;
      seen.add(k);
      conflicts.push({ name: h.name, day: DAY_NAMES[h.dayN - 1]!, slot: h.when });
    }
  }
  return conflicts;
}
