// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课程类型判定（纯函数）
// ═══════════════════════════════════════════════════════════════
import type { Course, Flag } from './types';

export const courseFlag = (course: Course): Flag => {
  const a = (course.attr || '').trim();
  if (a === '限选') return 'xx';
  if (a === '任选') return 'rx';
  if (a === '体育' && !NOT_SPORTS_NAME.test(course.name || '')) return 'ty';
  if (a === '必修') return 'bx';
  return 'rx';
};

/** 体育课判定（用户二十三报规则）：航空体育、书院专项体育、体育学术课都不是体育课 */
export const NOT_SPORTS_NAME = /航空体育|书院专项体育|体育(概论|管理|课程与教学论|科技前沿)/;

export function isSportsCourse(course: Course | null | undefined): boolean {
  if (!course) return false;
  if (NOT_SPORTS_NAME.test(course.name || '')) return false;
  if ((course.attr || '') === '体育' || course.typeLabel === '体育' || course.typeCode === 'ty') return true;
  const dept = course.department || '';
  if (!dept.includes('体育') && !dept.includes('体武')) return false;
  return true;
}

export const baseFlag = (course: Course): Flag => (isSportsCourse(course) ? 'ty' : courseFlag(course));

export function allowedFlags(bf: Flag): Flag[] {
  if (bf === 'ty') return ['ty'];
  if (bf === 'bx') return ['bx', 'xx', 'rx'];
  if (bf === 'xx') return ['xx', 'rx'];
  return ['rx'];
}

export function typeCodeToFlag(typeCode: string | undefined): Flag {
  return typeCode === '006' ? 'bx' : typeCode === '008' ? 'xx' : typeCode === '007' ? 'rx' : typeCode === 'ty' ? 'ty' : 'bx';
}

export function zyTypeOf(course: Course): Flag {
  if ((course.typeLabel === '体育' || course.typeCode === 'ty') && !NOT_SPORTS_NAME.test(course.name || '')) return 'ty';
  return ({ '006': 'bx', '008': 'xx', '007': 'rx' } as Record<string, Flag>)[course.typeCode || ''] || 'bx';
}

export const flagName = (flag: Flag): string => (flag === 'bx' ? '必修' : flag === 'xx' ? '限选' : flag === 'rx' ? '任选' : '体育');

/** 志愿档位合法（同一类型档位名额上限；体育 1/2 志愿各 1 门） */
export function canAdjustZy(pool: Course[], course: Course | undefined, targetZy: number, limits: Record<Flag, [number, number][]>): boolean {
  if (!course) return false;
  const zt = zyTypeOf(course);
  let count = 0;
  pool.forEach(c => {
    if (!c.selected) return;
    if (c.code === course.code && String(c.seq || '0') === String(course.seq || '0')) return;
    if (zyTypeOf(c) !== zt) return;
    if (c.zy === targetZy) count++;
  });
  const limitsOf = limits[zt] || limits.bx;
  return count < (limitsOf[targetZy - 1]?.[1] ?? 0);
}
