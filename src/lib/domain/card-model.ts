// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课程卡视图模型（纯函数）：容量条 · 开课线 · 中签链 · 涨跌 · 折叠行数字 · 冲突摘要
// 组件只负责 $state（选择器/展开/busy）与事件；口径规则全在这里，可 vitest 直接覆盖。
// ═══════════════════════════════════════════════════════════════
import type { Course, Flag, QueueDatum } from './types';
import { ZY_LIMITS } from '../core/constants';
import { keyOf } from '../core/utils';
import { canAdjustZy, flagName, typeCodeToFlag } from './flags';
import {
  capacityStatus,
  cascadeOf,
  currentProbMeta,
  lockedOf,
  probGridData,
  queueCapTitle,
  volColor,
  type CapacityStatus,
  type CascadeStatus,
  type VolColor,
} from './probability';
import { trendDelta, type VolPoint } from './probhist';
import { originOf, parseTimeSlots, slotDisplayName } from './time';
import { conflictsWithPreview, type PreviewSpan } from './conflict';

/** 开课线：已选/报名 少于 5 人有停开风险 */
export const OPEN_LINE = 5;

export interface ChainNode {
  key: string;
  label: string;
  pct: string;
  muted: boolean;
  color: string;
  ratio: string;
  active: boolean;
  title: string;
  flag: Flag;
  zy: number;
}

export interface CardCapText {
  text: string;
  title: string;
  pct: number;
  color: string;
}

export interface CardMiniNum {
  text: string;
  color: string;
  title: string;
}

export interface CardInput {
  course: Course;
  isQueuePhase: boolean;
  /** 未选课时选择器的当前「类型 × 志愿」（已选课按 typeCode/zy 覆盖） */
  selFlag: Flag;
  selZy: number;
  queueDataMap: Record<string, QueueDatum>;
  candidateCourses: Course[];
  /** 志愿可调性判定池（已选行） */
  allCourses: Course[];
  /** 课班历史概率点（涨跌用；缺失 → 不显示） */
  hist: VolPoint[] | undefined;
  /** 预览冲突时段表（CourseList 单次计算后下发） */
  conflictSpans: PreviewSpan[];
}

export interface CardModel {
  vc: VolColor;
  meta: ReturnType<typeof currentProbMeta>;
  curFlag: Flag;
  curZy: number;
  selZyDisp: number;
  cs: CapacityStatus | null;
  cascade: CascadeStatus | null;
  capText: CardCapText | null;
  openRisk: { used: number; label: string } | null;
  chain: ChainNode[];
  delta: number | null;
  miniNum: CardMiniNum | null;
  conflicts: { name: string; day: string; slot: string }[];
  conflictMini: { label: string; title: string } | null;
  subText: string;
  origins: string;
  zyUp: boolean;
  zyDown: boolean;
  zyUpTitle: string;
  zyDownTitle: string;
}

const flagShort = (f: Flag): string => (f === 'bx' ? '必' : f === 'xx' ? '限' : f === 'rx' ? '任' : '体');

/** 教师·课序·时间合并小字（折叠行与展开态标签行共用；title 保留原始时间串） */
function subTextOf(course: Course): string {
  const parts: string[] = [];
  if (course.teacher) parts.push(course.teacher);
  if (course.seq) parts.push(course.seq + '课序');
  const timeSlots = parseTimeSlots(course.time);
  if (timeSlots.length) {
    parts.push(timeSlots.map((s) => s.day + '·' + slotDisplayName(s.slot) + (s.week !== '全周' ? '(' + s.week + ')' : '')).join(' / '));
  } else if (course.time) {
    parts.push(course.time);
  }
  return parts.join(' · ');
}

/** 容量条文字：课余量「候补位次 · 已选X · 余Y · 排队Z」；预选「同志愿N争s · 已选锁定+优先」 */
function capTextOf(course: Course, isQueuePhase: boolean, cs: CapacityStatus | null, cand: Course | undefined, cascade: CascadeStatus | null, metaColor: string, vc: VolColor): CardCapText | null {
  if (isQueuePhase) {
    if (!cs) return null;
    const rem = cs.rem != null ? `余${cs.rem}` : '';
    const queue = cs.queue > 0 ? `排队${cs.queue}` : '';
    const base = `已选${cs.used}` + (rem ? ` · ${rem}` : '') + (queue ? ` · ${queue}` : '');
    const prefix = cand ? `候补第${cand.myPos}/${cand.queueTotal} · ` : '';
    return { text: prefix + base, title: queueCapTitle(cs), pct: cs.pct, color: vc.color };
  }
  const lo = lockedOf(course);
  if (cascade) {
    const denom = (lo && lo.cap) || cascade.pool;
    if (cascade.hasVol) {
      // 条宽=需求口径：上批锁定 + 本批报名(统计页已报) vs 总容量；文字仍显本档 同志愿N争s · 已选锁定+优先
      const used = (lo ? lo.locked : 0) + cascade.prior;
      const demand = (lo ? lo.locked : 0) + (Number(course.volApplied) || 0);
      return {
        text: `${cascade.peers}/${cascade.seats}` + (lo ? ` · 已选${used}` : ''),
        title: (lo ? `已选${lo.locked}(上批)+${cascade.prior}(优先)` : `已选${cascade.prior}(优先)`) + ` · 同志愿${cascade.peers}争${cascade.seats} · 总容量${denom}`,
        pct: Math.min(100, (demand / denom) * 100),
        color: metaColor,
      };
    }
  }
  // 本批志愿数据缺：回退搜索页裸数据（灰条）
  if (lo) {
    return {
      text: `已选${lo.locked} · 余${lo.rem}`,
      title: `已选${lo.locked} · 余${lo.rem} · 总容量${lo.cap}（本批志愿数据缺）`,
      pct: (lo.locked / lo.cap) * 100,
      color: '#9aa1ac',
    };
  }
  return null;
}

/** 开课线：课余量已选 / 预选 上批锁定+本批报名 少于 5 人有停开风险 */
function openRiskOf(course: Course, isQueuePhase: boolean, cs: CapacityStatus | null): { used: number; label: string } | null {
  if (isQueuePhase) {
    if (!cs) return null;
    if (cs.used <= 0 || cs.used >= OPEN_LINE) return null;
    return { used: cs.used, label: '已选' };
  }
  const lo = lockedOf(course);
  const used = (lo ? lo.locked : 0) + (Number(course.volApplied) || 0);
  if (used <= 0 || used >= OPEN_LINE) return null;
  return { used, label: '报名' };
}

/** 级联中签率链：节点=类型×志愿，底色=各自概率；当前选法描边；点击查看趋势 */
function chainOf(course: Course, isQueuePhase: boolean, curFlag: Flag, curZy: number): ChainNode[] {
  if (isQueuePhase) return [];
  const out: ChainNode[] = [];
  for (const row of probGridData(course)) {
    for (const cell of row.cells) {
      const pri = !!cell.pri;
      const active = !pri && row.flag === curFlag && cell.zy === curZy;
      const muted = (cell.prob ?? -1) < 0;
      const ratio = cell.ratioLabel || '';
      const title = (pri ? '任选 优先任选' : `${flagName(row.flag)} ${cell.zy}志愿`) + ` · ${cell.percentLabel || cell.label}${ratio && ratio !== '无数据' ? ' · ' + ratio : ''} · 点击看趋势`;
      out.push({
        key: row.flag + (pri ? 'p' : cell.zy),
        label: pri ? '优先' : flagShort(row.flag) + cell.zy,
        pct: cell.percentLabel || cell.label || '—',
        muted,
        color: cell.color,
        ratio,
        active,
        title,
        flag: row.flag,
        zy: cell.zy,
      });
    }
  }
  return out;
}

/** 折叠行关键数字：已选显志愿档；课余量「候补x/y · 余Y · 排队Z」；预选当前选法概率% */
function miniNumOf(course: Course, isQueuePhase: boolean, selZyDisp: number, cs: CapacityStatus | null, cand: Course | undefined, vc: VolColor, meta: CardModel['meta']): CardMiniNum | null {
  if (course.selected) {
    if (selZyDisp > 0) return { text: '第' + selZyDisp + '志愿', color: '#07a150', title: course.typeLabel || '' };
    return course.typeLabel ? { text: course.typeLabel, color: '#07a150', title: '' } : null;
  }
  if (isQueuePhase) {
    if (!cs) return null;
    const rem = cs.rem != null ? '余' + cs.rem : '';
    const q = cs.queue > 0 ? ' · 排队' + cs.queue : '';
    const prefix = cand ? `候补${cand.myPos ?? '?'}/${cand.queueTotal ?? '?'} · ` : '';
    return { text: prefix + rem + q, color: vc.color, title: queueCapTitle(cs) };
  }
  const ratio = meta.ratioLabel && meta.ratioLabel !== '无数据' ? ' · ' + meta.ratioLabel : '';
  return { text: meta.prob >= 0 ? (meta.percentLabel ?? '') : meta.label, color: meta.color, title: `${meta.flagLabel} ${meta.zy}志愿${ratio}` };
}

export function courseCardModel(input: CardInput): CardModel {
  const { course, isQueuePhase, selFlag, selZy, queueDataMap, candidateCourses, allCourses, hist, conflictSpans } = input;

  const key = keyOf(course.code, course.seq);
  const qd = queueDataMap[key];
  const cand = candidateCourses.find((cc) => keyOf(cc.code, cc.seq) === key);

  const vc = volColor(course, isQueuePhase);
  const selZyDisp = course.zy || 0;
  const curFlag: Flag = course.selected ? typeCodeToFlag(course.typeCode) : selFlag;
  const curZy = course.selected ? course.zy || 3 : selZy;
  const meta = currentProbMeta(course, curFlag, curZy);

  const cs = isQueuePhase ? capacityStatus(course, qd) : null;
  const cascade = isQueuePhase ? null : cascadeOf(course, curFlag, curZy);

  const conflicts = conflictSpans.length ? conflictsWithPreview(course, conflictSpans) : [];
  const first = conflicts[0];
  const conflictMini = first
    ? {
        label: `冲突 ${first.day}${first.slot} ${first.name}` + (conflicts.length > 1 ? ` +${conflicts.length - 1}` : ''),
        title: '时间冲突：' + conflicts.map((cf) => `${cf.day}${cf.slot} 与「${cf.name}」`).join('；'),
      }
    : null;

  const zyUpOk = !!(course.zy && course.zy > 1 && canAdjustZy(allCourses, course, course.zy - 1, ZY_LIMITS));
  const zyDownOk = !!(course.zy && course.zy < 3 && canAdjustZy(allCourses, course, course.zy + 1, ZY_LIMITS));

  return {
    vc,
    meta,
    curFlag,
    curZy,
    selZyDisp,
    cs,
    cascade,
    capText: capTextOf(course, isQueuePhase, cs, cand, cascade, meta.color, vc),
    openRisk: openRiskOf(course, isQueuePhase, cs),
    chain: chainOf(course, isQueuePhase, curFlag, curZy),
    delta: isQueuePhase ? null : trendDelta(hist, curFlag, curZy),
    miniNum: miniNumOf(course, isQueuePhase, selZyDisp, cs, cand, vc, meta),
    conflicts,
    conflictMini,
    subText: subTextOf(course),
    origins: originOf(course.code),
    zyUp: zyUpOk,
    zyDown: zyDownOk,
    zyUpTitle: course.zy && course.zy > 1 ? (zyUpOk ? '升为第' + (course.zy - 1) + '志愿' : '该志愿名额已满') : '',
    zyDownTitle: course.zy && course.zy < 3 ? (zyDownOk ? '降为第' + (course.zy + 1) + '志愿' : '该志愿名额已满') : '',
  };
}
