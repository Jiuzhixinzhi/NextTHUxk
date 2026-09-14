// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课程身份匹配（纯函数）
// 课序号会陈旧/缺位，教师才是最高身份（上游 #33「课序会骗人」）；
// 池行三段匹配修同课号多班借错时间/学分（上游 d28bdb5 同款）。
// ═══════════════════════════════════════════════════════════════
import type { Course } from './types';
import { normSeq } from '../core/utils';

/** 教师归一（去空白+小写） */
export function normTeacher(s: string | undefined | null): string {
  return (s || '').toLowerCase().replace(/\s+/g, '');
}

/** 教师命中：行教师含查询教师即可（多师行「刘烨、王洪川」含「刘烨」）；
 *  反向包含不做——查询串含多师时防「王洪川」单师行误中 */
export function teacherHit(r: Course, teacher: string): boolean {
  if (!teacher) return false;
  const t = normTeacher(r.teacher);
  return !!t && (t === teacher || t.includes(teacher));
}

/** 池行三段匹配：归一精确课序 → 同课同师 → 首行兜底（rows 须已按课号过滤）。
 *  同课号多班下直接取 rows[0] 会借错时间/学分张冠李戴。 */
export function matchPoolRow(rows: Course[], seq: string | number | undefined | null, teacher?: string | null): Course | undefined {
  if (!rows || !rows.length) return undefined;
  const ns = normSeq(seq || '0');
  const t = normTeacher(teacher);
  return (
    rows.find(x => normSeq(x.seq || '0') === ns) ||
    (t ? rows.find(x => teacherHit(x, t)) : undefined) ||
    rows[0]
  );
}
