// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 草稿模型（纯函数：构建 / 差量对齐）
// 草稿 = 可直接编辑的命名方案集合，活跃草稿 = 当前编辑目标。
// ═══════════════════════════════════════════════════════════════
import type { Course, Draft, DraftCourse, Flag } from './types';
import { allowedFlags, baseFlag, typeCodeToFlag } from './flags';
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

/** 已选行 → 草稿条目（typeCode 含体育；zy 兜底 3；flag 必须落在 baseFlag 允许集内，
 *  否则 typeCode 缺失时 typeCodeToFlag 兜底 'bx' 会与 baseFlag='rx' 失配，下拉框渲染成空白） */
export function draftCourseFromSelected(c: Course): DraftCourse {
  const bf = baseFlag(c);
  const f = typeCodeToFlag(c.typeCode);
  return {
    code: c.code,
    seq: c.seq || '0',
    name: c.name,
    teacher: c.teacher || '',
    time: c.time || '',
    credits: c.credits || 0,
    flag: allowedFlags(bf).includes(f) ? f : bf,
    zy: c.zy || 3,
    baseFlag: bf,
    note: c.note || c.xkTextNote || '',
  };
}

/** 草稿条目破损态修复：baseFlag 缺失/非法归 rx；flag 不在允许集 → 重置 baseFlag；zy 非 1/2/3 → 归 3（返回是否改动） */
export function repairDraftCourse(c: DraftCourse): boolean {
  let changed = false;
  const raw = c.baseFlag as Flag | undefined;
  if (raw !== 'ty' && raw !== 'bx' && raw !== 'xx' && raw !== 'rx') {
    c.baseFlag = 'rx';
    changed = true;
  }
  const bf = c.baseFlag as Flag;
  if (!allowedFlags(bf).includes(c.flag)) {
    c.flag = bf;
    changed = true;
  }
  const z = parseInt(String(c.zy), 10);
  if (!z || z < 1 || z > 3) {
    c.zy = 3;
    changed = true;
  }
  return changed;
}

// ─── 已选并入草稿（纯合并逻辑；存储/通知等副作用由调用方编排） ───

export interface MergeSelectedIns {
  added: number;
  /** 已在稿且 zy 与已选侧一致（或已选侧无真实 zy），未同步 */
  skipped: number;
  /** 已在稿但 zy 被同步为已选侧真实志愿的行数 */
  synced: number;
}

/** 已选整表并入草稿：按课班去重；已在稿的行以服务端真实 zy 回写（zy>0 才同步，不动 flag） */
export function mergeSelectedIntoDraft(d: Draft, selected: Course[]): MergeSelectedIns {
  let added = 0,
    skipped = 0,
    synced = 0;
  const index = new Map<string, DraftCourse>();
  d.courses.forEach(c => index.set(draftKeyOf(c), c));
  selected.forEach(row => {
    const key = draftKeyOf(row);
    const exist = index.get(key);
    if (exist) {
      let touched = repairDraftCourse(exist);
      const realZy = Math.max(0, parseInt(String(row.zy), 10)) || 0;
      if (realZy > 0 && exist.zy !== realZy) {
        exist.zy = realZy;
        synced++;
        touched = true;
      } else if (!touched) {
        skipped++;
      }
      return;
    }
    const dc = draftCourseFromSelected(row);
    index.set(key, dc);
    d.courses.push(dc);
    added++;
  });
  return { added, skipped, synced };
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
