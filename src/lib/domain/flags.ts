// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课程类型判定（纯函数）
// ═══════════════════════════════════════════════════════════════
import type { Course, Flag } from './types';
import { keyOf } from '../core/utils';

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

/** 入稿（草稿/暂存）类型：优先页面 attr，缺失时按 typeCode 推导。
 *  候补行常无 attr（dlSearch/kbSearch 不标列），直接用 baseFlag 会回落任选，
 *  把必修/限选候补存成任选、提交时选错类型。 */
export function entryBaseFlag(course: Course): Flag {
  if (isSportsCourse(course)) return 'ty';
  if ((course.attr || '').trim()) return courseFlag(course);
  if (course.typeCode) return typeCodeToFlag(course.typeCode);
  return courseFlag(course); // attr/typeCode 均缺：沿用旧语义（rx 兜底）
}

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
    // keyOf 归一（B1 尾项）：'01'/'1' 同课班两种拼写不得把自己算进档位上限
    if (keyOf(c.code, c.seq) === keyOf(course.code, course.seq)) return;
    if (zyTypeOf(c) !== zt) return;
    if (c.zy === targetZy) count++;
  });
  const limitsOf = limits[zt] || limits.bx;
  return count < (limitsOf[targetZy - 1]?.[1] ?? 0);
}
