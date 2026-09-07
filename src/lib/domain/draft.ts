// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 草稿模型（纯函数：构建 / 差量对齐）
// 草稿 = 可直接编辑的命名方案集合，活跃草稿 = 当前编辑目标。
// ═══════════════════════════════════════════════════════════════
import type { Course, Draft, DraftCourse, Flag } from './types';
import { baseFlag, typeCodeToFlag } from './flags';
import { normSeq } from '../core/utils';

export function draftCourseFrom(c: Course, flag: Flag, zy: number, fallbackFlag: Flag = 'rx'): DraftCourse {
  return {
    code: c.code,
    seq: c.seq || '0',
    name: c.name,
    teacher: c.teacher || '',
    time: c.time || '',
    credits: c.credits || 0,
    flag,
    zy: parseInt(String(zy), 10) || 3,
    baseFlag: baseFlag(c) || fallbackFlag,
    note: c.note || c.xkTextNote || '', // 外校真实时间载体
  };
}

/** 已选行 → 草稿条目（typeCode 含体育；zy 兜底 3） */
export function draftCourseFromSelected(c: Course): DraftCourse {
  return {
    code: c.code,
    seq: c.seq || '0',
    name: c.name,
    teacher: c.teacher || '',
    time: c.time || '',
    credits: c.credits || 0,
    flag: typeCodeToFlag(c.typeCode),
    zy: c.zy || 3,
    baseFlag: baseFlag(c),
    note: c.note || c.xkTextNote || '',
  };
}

export function newDraft(name: string, courses: DraftCourse[]): Draft {
  return { id: Date.now(), name, courses: [...courses], createdAt: Date.now() };
}

export function draftKeyOf(c: { code: string; seq: string | number }) {
  return c.code + '_' + normSeq(c.seq);
}

/** 差量对齐（用户定稿）：复合键相同且志愿/属性一致才算重合，重合课不退不重选；
 *  已选侧信息不全（zy=0/typeCode 空，兜底路径）→ 视为不一致退+重选。 */
export interface DraftDiff {
  kept: Course[];
  toDrop: Course[];
  toAdd: DraftCourse[];
}

export function sameAsDraft(selected: Course, dc: DraftCourse): boolean {
  return !!selected.zy && (parseInt(String(dc.zy), 10) || 3) === selected.zy && !!selected.typeCode && typeCodeToFlag(selected.typeCode) === (dc.flag || 'bx');
}

export function draftDiff(currentSelected: Course[], draftCourses: DraftCourse[]): DraftDiff {
  const curMap = new Map<string, Course>();
  currentSelected.forEach(s => curMap.set(s.code + '_' + normSeq(s.seq), s));
  const toDrop = currentSelected.filter(s => {
    const c = draftCourses.find(x => x.code === s.code && normSeq(x.seq) === normSeq(s.seq));
    return !(c && sameAsDraft(s, c));
  });
  const toAdd: DraftCourse[] = [];
  const addedKeys = new Set<string>();
  draftCourses.forEach(c => {
    const k = c.code + '_' + normSeq(c.seq);
    const cur = curMap.get(k);
    if (cur && sameAsDraft(cur, c)) return;
    if (addedKeys.has(k)) return;
    addedKeys.add(k);
    toAdd.push(c);
  });
  return { kept: currentSelected.filter(s => !toDrop.includes(s)), toDrop, toAdd };
}

/** 草稿载入/备份时补 baseFlag 缺位（旧数据迁移语义；不含池中行时兜底 rx） */
export function repairDraftCourses(courses: DraftCourse[], pool: Course[], fallback = 'rx'): boolean {
  let changed = false;
  courses.forEach(c => {
    if (!c.baseFlag) {
      const ac = pool.find(x => x.code === c.code);
      c.baseFlag = ac ? baseFlag(ac) : (fallback as Flag);
      changed = true;
    }
  });
  return changed;
}
