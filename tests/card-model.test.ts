// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课程卡视图模型测试（容量条/开课线/中签链/折叠行/冲突摘要）
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { courseCardModel, type CardInput } from '../src/lib/domain/card-model';
import { buildPreviewSpans } from '../src/lib/domain/conflict';
import type { Course, Flag } from '../src/lib/domain/types';

const course = (v: Record<string, unknown> = {}): Course =>
  ({ code: 'A', seq: '01', name: '甲课', credits: 3, time: '1-2(1-16周)', typeCode: '1', ...v }) as unknown as Course;

function input(c: Course, extra: Partial<CardInput> = {}): CardInput {
  return {
    course: c,
    isQueuePhase: false,
    selFlag: 'bx' as Flag,
    selZy: 1,
    queueDataMap: {},
    candidateCourses: [],
    allCourses: [c],
    hist: undefined,
    conflictSpans: [],
    ...extra,
  };
}

const qd = (qRemaining: number, qQueue: number, qCapacity = 40) => ({
  A_1: { code: 'A', seq: '01', qRemaining, qQueue, qCapacity },
});

describe('courseCardModel · 课余量容量条', () => {
  it('三数口径 + 配色取自占用比（与 volColor 同源）', () => {
    const m = courseCardModel(input(course({ capacity: 40, remaining: 33 }), { isQueuePhase: true, queueDataMap: qd(7, 5) }));
    expect(m.cs).toMatchObject({ used: 33, rem: 7, queue: 5, cap: 40 });
    expect(m.capText).toMatchObject({ text: '已选33 · 余7 · 排队5', title: '已选33 · 余7 · 排队5 · 容量40' });
    expect(m.capText!.pct).toBeCloseTo(82.5);
  });

  it('候补行加位次前缀（卡片「第」/折叠行无「第」）', () => {
    const cand = course({ code: 'A', seq: '01', myPos: 2, queueTotal: 9 });
    const m = courseCardModel(
      input(course({ capacity: 40, remaining: 33 }), { isQueuePhase: true, queueDataMap: qd(7, 5), candidateCourses: [cand] }),
    );
    expect(m.capText!.text).toBe('候补第2/9 · 已选33 · 余7 · 排队5');
    expect(m.miniNum!.text).toBe('候补2/9 · 余7 · 排队5');
    expect(m.miniNum!.title).toBe('已选33 · 余7 · 排队5 · 容量40');
  });

  it('无容量数据 → 容量条/开课线/折叠行数字一并缺省', () => {
    const m = courseCardModel(input(course({ capacity: 0 }), { isQueuePhase: true }));
    expect(m.cs).toBeNull();
    expect(m.capText).toBeNull();
    expect(m.openRisk).toBeNull();
    expect(m.miniNum).toBeNull();
  });
});

describe('courseCardModel · 预选级联条', () => {
  const volCourse = () => course({ capacity: 35, remaining: 5, volCapacity: 5, volApplied: 30, volRequired: '(1)1,29,0' });

  it('本批志愿齐备：同志愿N争s · 已选(上批+优先)，条宽走需求口径', () => {
    const m = courseCardModel(input(volCourse(), { selFlag: 'bx' as Flag, selZy: 2 }));
    expect(m.cascade).toMatchObject({ pool: 5, prior: 1, peers: 29, seats: 4 });
    expect(m.capText!.text).toBe('29/4 · 已选31');
    expect(m.capText!.title).toBe('已选30(上批)+1(优先) · 同志愿29争4 · 总容量35');
    expect(m.capText!.pct).toBe(100); // 需求 60 / 35 越界 → 收敛 100
  });

  it('本类型志愿串缺 → 灰条回退搜索页裸数据', () => {
    const m = courseCardModel(input(volCourse(), { selFlag: 'xx' as Flag, selZy: 1 }));
    expect(m.cascade!.hasVol).toBe(false);
    expect(m.capText).toMatchObject({ text: '已选30 · 余5', color: '#9aa1ac' });
    expect(m.capText!.title).toContain('本批志愿数据缺');
  });

  it('无容量亦无搜索页锁定 → 无容量条', () => {
    const m = courseCardModel(input(course({ code: 'A', seq: '01' })));
    expect(m.cascade).toBeNull();
    expect(m.capText).toBeNull();
  });
});

describe('courseCardModel · 开课线（少于 5 人）', () => {
  it('课余量按已选数，预选按锁定+报名数', () => {
    const queued = courseCardModel(input(course({ capacity: 10, remaining: 7 }), { isQueuePhase: true }));
    expect(queued.openRisk).toEqual({ used: 3, label: '已选' });
    const preset = courseCardModel(input(course({ capacity: 40, remaining: 37 })));
    expect(preset.openRisk).toEqual({ used: 3, label: '报名' });
  });

  it('达线（=5）与零占用不计风险', () => {
    expect(courseCardModel(input(course({ capacity: 10, remaining: 5 }), { isQueuePhase: true })).openRisk).toBeNull();
    expect(courseCardModel(input(course({ capacity: 40, remaining: 40 }))).openRisk).toBeNull();
  });
});

describe('courseCardModel · 中签链与涨跌', () => {
  it('预选：节点含 active 当前选法；课余量阶段无链', () => {
    const c = course({ capacity: 35, remaining: 5, volCapacity: 5, volApplied: 30, volRequired: '(1)1,29,0' });
    const m = courseCardModel(input(c, { selFlag: 'bx' as Flag, selZy: 2 }));
    expect(m.chain.length).toBeGreaterThan(0);
    expect(m.chain.find((n) => n.active)!.label).toBe('必2');
    expect(m.chain.find((n) => n.active)!.flag).toBe('bx');
    expect(courseCardModel(input(c, { isQueuePhase: true })).chain).toEqual([]);
  });

  it('涨跌：课余量阶段与历史不足 2 点均不显示', () => {
    expect(courseCardModel(input(course(), { isQueuePhase: true })).delta).toBeNull();
    expect(courseCardModel(input(course())).delta).toBeNull();
  });
});

describe('courseCardModel · 折叠行数字', () => {
  it('已选：显志愿档，缺档回退类型名', () => {
    const m = courseCardModel(input(course({ selected: true, zy: 2, typeLabel: '必修' })));
    expect(m.miniNum).toEqual({ text: '第2志愿', color: '#07a150', title: '必修' });
    const noZy = courseCardModel(input(course({ selected: true, zy: 0, typeLabel: '必修' })));
    expect(noZy.miniNum).toEqual({ text: '必修', color: '#07a150', title: '' });
    expect(noZy.selZyDisp).toBe(0);
  });
});

describe('courseCardModel · 冲突摘要', () => {
  const spans = buildPreviewSpans([course({ code: 'B', seq: '01', name: '乙课', time: '1-2(1-8周)' })], []);

  it('命中 → 列表 + 折叠行首条明示（+N）', () => {
    const m = courseCardModel(input(course({ time: '1-2(1-8周)' }), { conflictSpans: spans }));
    expect(m.conflicts).toEqual([{ name: '乙课', day: '周一', slot: '2大节' }]);
    expect(m.conflictMini).toEqual({ label: '冲突 周一2大节 乙课', title: '时间冲突：周一2大节 与「乙课」' });
  });

  it('周次不相交 → 不报（1-8 周 vs 9-16 周）', () => {
    const m = courseCardModel(input(course({ time: '1-2(9-16周)' }), { conflictSpans: spans }));
    expect(m.conflicts).toEqual([]);
    expect(m.conflictMini).toBeNull();
  });

  it('空时段表 → 短路不报', () => {
    expect(courseCardModel(input(course())).conflicts).toEqual([]);
    expect(courseCardModel(input(course())).conflictMini).toBeNull();
  });
});

describe('courseCardModel · 志愿可调性与小字', () => {
  it('志愿可调：2 志愿可升，1 志愿不可升、3 志愿不可降', () => {
    const up = courseCardModel(input(course({ selected: true, zy: 2 })));
    expect(up.zyUp).toBe(true);
    expect(up.zyUpTitle).toBe('升为第1志愿');
    const first = courseCardModel(input(course({ selected: true, zy: 1 })));
    expect(first.zyUp).toBe(false);
    expect(first.zyUpTitle).toBe('');
    const last = courseCardModel(input(course({ selected: true, zy: 3 })));
    expect(last.zyDown).toBe(false);
    expect(last.zyDownTitle).toBe('');
  });

  it('小字 = 教师 · 课序 · 时间档；无大节回退原始时间串', () => {
    const m = courseCardModel(input(course({ teacher: '张三', seq: '01', time: '1-2(1-8周)' })));
    expect(m.subText).toBe('张三 · 01课序 · 周一·2大节(1-8周)');
    const raw = courseCardModel(input(course({ time: '待定' })));
    expect(raw.subText).toBe('01课序 · 待定');
  });

  it('来源标签随课号', () => {
    expect(courseCardModel(input(course({ code: 'A' }))).origins).toBe('');
  });
});
