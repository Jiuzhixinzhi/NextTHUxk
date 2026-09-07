// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 冲突检测（区间重叠制，OneTHU 同款语义）
// 课程大节 → 钟点区间，自定义占用直接用钟点区间；跨边界部分重叠也能测出。
// ═══════════════════════════════════════════════════════════════
import type { Course, ManualEvent } from './types';
import { DAY_NAMES, spansOf } from './time';

export interface Conflict {
  day: string;
  slot: string;
  a: string;
  b: string;
}

export function detectConflicts(courses: (Course | ManualEvent)[], manualEvents: ManualEvent[]): Conflict[] {
  const spans: { dayN: number; begin: number; end: number; name: string; when: string }[] = [];
  const conflicts: Conflict[] = [];
  const addSpan = (dayN: number, begin: number, end: number, name: string, when: string) => {
    for (const s of spans) {
      if (s.dayN === dayN && begin < s.end && s.begin < end) {
        conflicts.push({ day: DAY_NAMES[dayN - 1]!, slot: when, a: s.name, b: name });
      }
    }
    spans.push({ dayN, begin, end, name, when });
  };
  courses.concat(manualEvents).forEach(c => {
    for (const s of spansOf(c)) addSpan(s.dayN, s.begin, s.end, c.name, s.when);
  });
  return conflicts;
}

// ─── 预览槽位索引（相同 day|slot 键 → 占用课程列表）─────────────

export interface PreviewHit {
  name: string;
  code: string;
  seq: string;
}

export function buildPreviewSlotIndex(
  previewCourses: (Course | ManualEvent)[],
  manualEvents: ManualEvent[],
): Map<string, PreviewHit[]> {
  const idx = new Map<string, PreviewHit[]>();
  previewCourses.concat(manualEvents).forEach(pc => {
    for (const { dayN, when } of spansOf(pc)) {
      const k = dayN + '|' + when;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k)!.push({ name: pc.name || pc.code, code: pc.code, seq: String(pc.seq || '0') });
    }
  });
  return idx;
}

export function conflictsWithPreview(course: Course, idx: Map<string, PreviewHit[]>): { name: string; day: string; slot: string }[] {
  if (!idx.size) return [];
  const selfSeq = String(course.seq || '0');
  const conflicts: { name: string; day: string; slot: string }[] = [];
  const seen = new Set<string>();
  for (const { dayN, when } of spansOf(course)) {
    const hits = idx.get(dayN + '|' + when);
    if (!hits) continue;
    for (const h of hits) {
      if (h.code === course.code && h.seq === selfSeq) continue;
      const k = h.name + '|' + dayN + '|' + when;
      if (seen.has(k)) continue;
      seen.add(k);
      conflicts.push({ name: h.name, day: DAY_NAMES[dayN - 1]!, slot: when });
    }
  }
  return conflicts;
}
