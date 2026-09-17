// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 域逻辑测试：时间解析 / 冲突 / 概率 / 草稿差量 / GBK
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { parseTimeSlots, clockRangesOf, pvToMin, spansOf, weeksOf, weeksOverlap } from '../src/lib/domain/time';
import { detectConflicts, buildPreviewSpans, conflictsWithPreview } from '../src/lib/domain/conflict';
import { calcProb, capacityStatus, cascadeOf, lockedOf, parseVolArr, probResult, priProb, probGridData, creditDist, creditSimItems, queueCapLevel, queueCapTitle } from '../src/lib/domain/probability';
import { draftDiff, draftCourseFrom, draftKeyOf, mergeSelectedIntoDraft, repairDraftCourse, sameAsDraft } from '../src/lib/domain/draft';
import { gbkPercentEncode } from '../src/lib/net/gbk';
import { normSeq, keyOf } from '../src/lib/core/utils';
import { checkPlanCoverage } from '../src/lib/domain/plancov';
import { creditsOf } from '../src/lib/domain/credits';
import { matchPoolRow, teacherHit } from '../src/lib/domain/match';
import { entryBaseFlag, canAdjustZy } from '../src/lib/domain/flags';
import { ZY_LIMITS } from '../src/lib/core/constants';

describe('parseTimeSlots', () => {
  it('解析标准大节（教务时间串 = 周X-第几节）', () => {
    const s = parseTimeSlots('1-2(1-16周),3-4(1-9周),5-6(1-16周)');
    expect(s).toHaveLength(3);
    expect(s[0]).toEqual({ day: '周一', slot: '3-4节', week: '1-16周' });
    expect(s[1]).toEqual({ day: '周三', slot: '7-8节', week: '1-9周' });
    expect(s[2]).toEqual({ day: '周五', slot: '11-12节', week: '1-16周' });
  });

  it('单双周', () => {
    const s = parseTimeSlots('2-6(双周)');
    expect(s[0]!.day).toBe('周二');
    expect(s[0]!.week).toBe('双周');
  });

  it('空串/无匹配', () => {
    expect(parseTimeSlots('')).toEqual([]);
    expect(parseTimeSlots('无固定时间')).toEqual([]);
  });

  it('同类项合并：同日同大节拆周段并集（4-6(1-7周),4-6(8周) → 4-6(1-8周)）', () => {
    const s = parseTimeSlots('4-6(1-7周),4-6(8周),2-4(5周)');
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ day: '周四', slot: '11-12节', week: '1-8周' });
    expect(s[1]).toEqual({ day: '周二', slot: '7-8节', week: '5周' });
  });

  it('非同周段不并集、非连续周段逗号分隔', () => {
    const s = parseTimeSlots('1-2(1-8周),1-2(10-16周)');
    expect(s).toHaveLength(1);
    expect(s[0]!.week).toBe('1-8周,10-16周');
    expect(parseTimeSlots('1-2(1-8周),3-4(1-16周)')).toHaveLength(2);
  });

  it('单双周无法数值化 → 文本拼接兜底且不重复', () => {
    const s = parseTimeSlots('2-6(单周),2-6(双周)');
    expect(s).toHaveLength(1);
    expect(s[0]!.week).toBe('单周,双周');
  });
});

describe('clockRangesOf（外校课钟点）', () => {
  it('复合日', () => {
    const r = clockRangesOf('周二、四 18:30-21:30(1-16周)', '');
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ day: 2, begin: 18 * 60 + 30, end: 21 * 60 + 30 });
    expect(r[1]!.day).toBe(4);
  });

  it('单双周标签', () => {
    const r = clockRangesOf('周二 14:00-16:00(单周)', '');
    expect(r[0]!.tag).toBe('单周');
  });

  it('分号多段', () => {
    const r = clockRangesOf('周一 9:00-10:00;周三 14:00-16:00', '');
    expect(r).toHaveLength(2);
    expect(r[0]!.day).toBe(1);
    expect(r[1]!.day).toBe(3);
  });

  it('空输入', () => {
    expect(clockRangesOf('', '')).toEqual([]);
  });
});

describe('冲突检测（区间重叠）', () => {
  it('同大节互斥（1-2 = 周一3-4节）', () => {
    const a = { code: '1', seq: '01', name: '甲', time: '1-2(1-16周)' };
    const b = { code: '2', seq: '01', name: '乙', time: '1-2(1-16周)' };
    const cs = detectConflicts([a, b] as never, []);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ day: '周一', slot: '3-4节' });
  });

  it('不同大节不冲突', () => {
    const a = { code: '1', seq: '01', name: '甲', time: '1-2(1-16周)' };
    const b = { code: '2', seq: '01', name: '乙', time: '1-4(1-16周)' };
    expect(detectConflicts([a, b] as never, [])).toHaveLength(0);
  });

  it('拆周段非同课自冲突（4-6(1-7周),4-6(8周) 合并为 4-6(1-8周)）', () => {
    const a = { code: '1', seq: '01', name: '甲', time: '4-6(1-7周),4-6(8周),2-4(5周)' };
    expect(detectConflicts([a] as never, [])).toHaveLength(0);
    const b = { code: '2', seq: '01', name: '乙', time: '2-4(1-16周)' };
    const cs = detectConflicts([a, b] as never, []);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ day: '周二', slot: '7-8节' });
  });

  it('半大节跨界重叠（大节 vs 自由钟点）', () => {
    const ev = { code: 'm2', seq: '0', name: '社团', day: 1, begin: '09:00', end: '10:30', manual: true as const, time: '', credits: 0 };
    const a = { code: '1', seq: '01', name: '甲', time: '1-2(1-16周)' };
    const cs = detectConflicts([a, ev] as never, []);
    expect(cs.length).toBeGreaterThan(0);
  });
});

describe('spansOf（manual 自由钟点）', () => {
  it('manual 走 begin/end 钟点分支，不经大节解析', () => {
    const s = spansOf({ manual: true, day: 3, begin: '18:30', end: '21:00', time: '' });
    expect(s).toEqual([{ dayN: 3, begin: 18 * 60 + 30, end: 21 * 60, when: '18:30-21:00', week: '', occ: 'all' }]);
  });

  it('manual 起止倒置/缺日 → 空区间', () => {
    expect(spansOf({ manual: true, day: 3, begin: '21:00', end: '18:30', time: '' })).toEqual([]);
    expect(spansOf({ manual: true, day: 0, begin: '18:30', end: '21:00', time: '' })).toEqual([]);
  });

  it('非 manual 不受 begin/end 干扰（仍走大节解析）', () => {
    const s = spansOf({ time: '1-2(1-16周)', begin: '18:30', end: '21:00' });
    expect(s).toHaveLength(1);
    expect(s[0]!.when).toBe('3-4节');
    expect(s[0]!.occ).not.toBe('unknown');
  });

  it('无大节 → 兜底解析文字说明钟点（外校课参与冲突/课表）', () => {
    const s = spansOf({ time: '', note: '周二 18:30-21:30(1-16周)' });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ dayN: 2, begin: 18 * 60 + 30, end: 21 * 60 + 30, when: '18:30-21:30', week: '1-16周' });
    expect(s[0]!.occ).not.toBe('unknown');
  });
});

describe('周次占用（1-8 周与 9-16 周本不冲突）', () => {
  const occCmp = (a: string, b: string) => weeksOverlap(weeksOf(a), weeksOf(b));

  it('周段不相交 → 不重叠；相交 → 重叠', () => {
    expect(occCmp('1-8周', '9-16周')).toBe(false);
    expect(occCmp('1-8周', '8-16周')).toBe(true);
    expect(occCmp('1-8周', '1-8周')).toBe(true);
  });

  it('单周 vs 双周不重叠；与全周/周段重叠', () => {
    expect(occCmp('单周', '双周')).toBe(false);
    expect(occCmp('单周', '全周')).toBe(true);
    expect(occCmp('单周', '1-8周')).toBe(true);
    expect(occCmp('1-8周', '双周')).toBe(true);
  });

  it('全周/缺信息 = 全占；无法数值化 = 保守判重叠', () => {
    expect(occCmp('全周', '1-8周')).toBe(true);
    expect(occCmp('', '9-16周')).toBe(true);
    expect(occCmp('开学后择期', '9-16周')).toBe(true);
    expect(weeksOf('开学后择期')).toBe('unknown');
    expect(weeksOf('')).toBe('all');
  });

  it('多段并集与单双周混排', () => {
    expect(occCmp('1-8周,10-16周', '9-10周')).toBe(true);
    expect(occCmp('1-7周,9周', '8-16周')).toBe(true);
    expect(occCmp('1-8周,10-16周', '9周')).toBe(false);
  });

  it('冲突检测按周次判互斥', () => {
    const a = { code: '1', seq: '01', name: '前半', time: '1-2(1-8周)' };
    const b = { code: '2', seq: '01', name: '后半', time: '1-2(9-16周)' };
    expect(detectConflicts([a, b] as never, [])).toHaveLength(0);
    const c = { code: '3', seq: '01', name: '全周', time: '1-2(1-16周)' };
    expect(detectConflicts([a, c] as never, [])).toHaveLength(1);
  });

  it('单周课与双周课同格不冲突，同奇偶则冲突', () => {
    const odd = { code: '1', seq: '01', name: '单', time: '1-2(单周)' };
    const even = { code: '2', seq: '01', name: '双', time: '1-2(双周)' };
    const odd2 = { code: '3', seq: '01', name: '单2', time: '1-2(单周)' };
    expect(detectConflicts([odd, even] as never, [])).toHaveLength(0);
    expect(detectConflicts([odd, odd2] as never, [])).toHaveLength(1);
  });

  it('周次不可数值化 → 保守判冲突', () => {
    const a = { code: '1', seq: '01', name: '甲', time: '1-2(待定周次)' };
    const b = { code: '2', seq: '01', name: '乙', time: '1-2(9-16周)' };
    expect(detectConflicts([a, b] as never, [])).toHaveLength(1);
  });
});

describe('预览冲突（buildPreviewSpans / conflictsWithPreview）', () => {
  const course = (code: string, seq: string, name: string, time: string) => ({ code, seq, name, time });
  const ev = { code: 'manual-1', seq: '0', name: '社团', day: 1, begin: '09:00', end: '10:30', manual: true as const, time: '', credits: 0 };

  it('周次不相交不报；相交才报（周段时间被纳入）', () => {
    const mine = course('9', '01', '我的', '1-2(9-16周)');
    const spans = buildPreviewSpans([course('1', '01', '前半', '1-2(1-8周)')], []);
    expect(conflictsWithPreview(mine as never, spans)).toHaveLength(0);
    const spans2 = buildPreviewSpans([course('1', '01', '全周', '1-2(1-16周)')], []);
    expect(conflictsWithPreview(mine as never, spans2)).toHaveLength(1);
  });

  it('自定义占用按区间相交命中（不再受槽位键限制）', () => {
    const mine = course('9', '01', '我的', '1-2(1-16周)');
    const spans = buildPreviewSpans([], [ev as never]);
    expect(conflictsWithPreview(mine as never, spans)).toHaveLength(1);
  });

  it('自排除按 keyOf 归一：01/1 拼写不再「与自己冲突」', () => {
    const mine = course('9', '01', '我的', '1-2(1-16周)');
    const spans = buildPreviewSpans([course('9', '1', '我的', '1-2(1-16周)')], []);
    expect(conflictsWithPreview(mine as never, spans)).toHaveLength(0);
  });
});

describe('概率模型', () => {
  const makeCourse = (volRequired: string, cap: number, applied: number) => ({
    code: 'x',
    seq: '1',
    name: '课',
    volRequired,
    volCapacity: cap,
    volApplied: applied,
  }) as never;

  it('parseVolArr 右对齐', () => {
    const arr = parseVolArr('(1)2');
    expect([...arr!]).toEqual([0, 0, 2]);
    expect((arr as unknown as { priority: number }).priority).toBe(1);
    expect([...parseVolArr('(1)2,4,5')!]).toEqual([2, 4, 5]);
    expect([...parseVolArr('(2)')!]).toEqual([0, 0, 0]);
    expect(parseVolArr('')).toBeNull();
  });

  it('必修第3志愿级联：前优先级者先得', () => {
    // 容量 50：1志愿15 2志愿20 3志愿25 → 3志愿竞争 50-35=15/25 人
    expect(calcProb(makeCourse('(1)15,20,25', 50, 50), 'bx', 3).prob).toBeCloseTo(15 / 25);
    // 容量 100：三志愿 15/20/25 → 3志愿剩 40，竞争25 → 100%
    const p = calcProb(makeCourse('(1)15,20,25', 100, 60), 'bx', 3);
    expect(p.prob).toBe(1);
  });

  it('无容量 → 无数据', () => {
    expect(calcProb(makeCourse('(1)1,1,1', 0, 0), 'bx', 1).prob).toBe(-1);
  });

  it('probResult 边界', () => {
    expect(probResult(10, 0).prob).toBe(1);
    expect(probResult(0, 99).prob).toBe(0);
    expect(probResult(10, 20).prob).toBe(0.5);
    expect(probResult(Number.NaN, 1).prob).toBe(-1);
  });
});

describe('capacityStatus（课余量：已选 · 余量 · 排队）', () => {
  const c = (v: Record<string, unknown>) => v as never;

  it('已选/余/排队 三段', () => {
    const s = capacityStatus(c({ capacity: 40 }), { code: 'x', seq: '1', qCapacity: 40, qRemaining: 7, qQueue: 5 });
    expect(s).toMatchObject({ cap: 40, used: 33, rem: 7, queue: 5 });
    expect(s!.pct).toBeCloseTo(82.5);
  });

  it('已满 = 余 0，排队仍有', () => {
    const s = capacityStatus(c({ capacity: 30 }), { code: 'x', seq: '1', qCapacity: 30, qRemaining: 0, qQueue: 12 });
    expect(s).toMatchObject({ used: 30, rem: 0, queue: 12, pct: 100 });
  });

  it('无 qd 数据回退课程 remaining', () => {
    const s = capacityStatus(c({ capacity: 20, remaining: 3 }), undefined);
    expect(s).toMatchObject({ cap: 20, used: 17, rem: 3, queue: 0 });
  });

  it('无容量 → null', () => {
    expect(capacityStatus(c({ capacity: 0 }), undefined)).toBeNull();
  });
});

describe('queueCapLevel / queueCapTitle（课余量档位三处同源）', () => {
  it('有余 → ok；无余有排队 → queued；皆无 → full', () => {
    expect(queueCapLevel(3, 0)).toBe('ok');
    expect(queueCapLevel(0, 5)).toBe('queued');
    expect(queueCapLevel(0, 0)).toBe('full');
    expect(queueCapLevel(null, 0)).toBe('full');
    expect(queueCapLevel(undefined, 2)).toBe('queued');
  });

  it('提示串：已选 · 余（缺 → —） · 排队 · 容量', () => {
    expect(queueCapTitle({ cap: 40, used: 33, rem: 7, queue: 5, pct: 82.5 })).toBe('已选33 · 余7 · 排队5 · 容量40');
    expect(queueCapTitle({ cap: 40, used: 40, rem: 0, queue: 0, pct: 100 })).toBe('已选40 · 余0 · 排队0 · 容量40');
  });

  it('previewBlockMeta 文案/配色取自同一档位表（余 / 排队 / 已满）', async () => {
    const { previewBlockMeta } = await import('../src/lib/domain/preview');
    const c = { code: 'a', seq: '01', name: 'A', time: '', credits: 1 } as never;
    const qd = (qRemaining: number, qQueue: number) => ({ a_1: { qRemaining, qQueue, qCapacity: 30 } });
    expect(previewBlockMeta(c, true, false, false, qd(2, 0), undefined, null)).toEqual({
      color: '#07c160', label: '余2', bg: 'rgba(7,193,96,.14)',
    });
    expect(previewBlockMeta(c, true, false, false, qd(0, 4), undefined, null)).toEqual({
      color: '#ff9f1a', label: '排队4人', bg: 'rgba(255,159,26,.14)',
    });
    expect(previewBlockMeta(c, true, false, false, qd(0, 0), undefined, null)).toEqual({
      color: '#ee4d4d', label: '已满', bg: 'rgba(238,77,77,.14)',
    });
  });
});

describe('cascadeOf / lockedOf（预选级联：池 · 上批锁定 · 优先 · 同志愿）', () => {
  const c = (v: Record<string, unknown>) => v as never;

  it('多批次：池=统计页容量，锁定=搜索页 容量-余量', () => {
    // 容量 35、上批报 30、本批优先 1、同志愿 29 → 争 4，显示 29/4 · 已选31
    const cs = cascadeOf(c({ volCapacity: 5, volApplied: 30, capacity: 35, remaining: 5, volRequired: '(1)1,29,0' }), 'bx', 2);
    expect(cs).toMatchObject({ pool: 5, cap: 35, locked: 30, prior: 1, peers: 29, seats: 4, hasVol: true });
    const p = calcProb(c({ volCapacity: 5, volApplied: 30, capacity: 35, remaining: 5, volRequired: '(1)1,29,0' }), 'bx', 2);
    expect(p.prob).toBeCloseTo(4 / 29);
    expect(p.ratioLabel).toBe('29/4');
  });

  it('首轮预选：余量=容量 → 锁定 0', () => {
    const cs = cascadeOf(c({ volCapacity: 50, capacity: 50, remaining: 50, volRequired: '(1)15,20,25' }), 'bx', 3);
    expect(cs).toMatchObject({ locked: 0, prior: 35, peers: 25, seats: 15 });
  });

  it('余量缺失 → locked null（不显示已选段）', () => {
    const cs = cascadeOf(c({ volCapacity: 50, volRequired: '(1)15,20,25' }), 'bx', 1);
    expect(cs).toMatchObject({ locked: null, prior: 0, peers: 15, seats: 50 });
  });

  it('统计页容量 0（已满课）→ 池无数据返回 null', () => {
    expect(cascadeOf(c({ volCapacity: 0, capacity: 35, volRequired: '(1)1,1,1' }), 'bx', 1)).toBeNull();
  });

  it('本类型志愿串缺 → hasVol false，概率无数据', () => {
    const cs = cascadeOf(c({ volCapacity: 50, volRequired: '(1)15,20,25' }), 'xx', 1);
    expect(cs!.hasVol).toBe(false);
    expect(calcProb(c({ volCapacity: 50, volRequired: '(1)15,20,25' }), 'xx', 1).prob).toBe(-1);
  });

  it('lockedOf：搜索页 容量-余量 口径', () => {
    expect(lockedOf(c({ capacity: 35, remaining: 5 }))).toEqual({ locked: 30, rem: 5, cap: 35 });
    expect(lockedOf(c({ capacity: 35, remaining: 99 }))).toBeNull();
    expect(lockedOf(c({ capacity: 0, remaining: 5 }))).toBeNull();
    expect(lockedOf(c({ capacity: 35 }))).toBeNull();
  });
});

describe('学分模拟（伯努利卷积）', () => {
  it('两门课全中 → 确定分布', () => {
    const items = [
      { name: 'a', credits: 3, liveProb: 1, prob: 1 },
      { name: 'b', credits: 2, liveProb: 1, prob: 1 },
    ];
    const d = creditDist(items);
    expect(d.total).toBe(5);
    expect(d.mode).toBe(5);
    expect(d.points).toEqual([{ credits: 5, prob: 1 }]);
  });

  it('0.5/0.5 卷积出双峰', () => {
    const items = [
      { name: 'a', credits: 1, liveProb: 0.5, prob: 0.5 },
      { name: 'b', credits: 1, liveProb: 0.5, prob: 0.5 },
    ];
    const d = creditDist(items);
    const p0 = d.points.find((p) => p.credits === 0)!.prob;
    const p1 = d.points.find((p) => p.credits === 1)!.prob;
    const p2 = d.points.find((p) => p.credits === 2)!.prob;
    expect(p1).toBeCloseTo(0.5);
    expect(p0).toBeCloseTo(0.25);
    expect(p2).toBeCloseTo(0.25);
  });

  it('prob=null 不参与', () => {
    const d = creditDist([
      { name: 'a', credits: 3, liveProb: null, prob: null },
      { name: 'b', credits: 2, liveProb: 1, prob: 1 },
    ]);
    expect(d.total).toBe(2);
  });

  it('creditSimItems 实时取值快照', () => {
    const c = {
      code: '1', seq: '1', name: '课', credits: 3, flag: 'bx', zy: 3,
      volRequired: '(1)1,1,1', volCapacity: 10, volApplied: 5,
    } as never;
    const items = creditSimItems([c], {
      isQueuePhase: false,
      queueDataMap: {},
      courseLookup: () => c,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.prob).toBeGreaterThan(0);
  });

  it('creditSimItems 队列阶段：正选锁定恒 1，候补走余量/手动', () => {
    const held = { code: '100', seq: '01', name: '锁', credits: 3, flag: 'bx', zy: 1 } as never;
    const cand0 = { code: '200', seq: '01', name: '候', credits: 2, flag: 'rx', zy: 3 } as never;
    const cand1 = { code: '300', seq: '01', name: '候2', credits: 2, flag: 'rx', zy: 3 } as never;
    const items = creditSimItems([held, cand0, cand1], {
      isQueuePhase: true,
      queueDataMap: {
        '100_1': { qRemaining: 0 } as never,
        '200_1': { qRemaining: 0 } as never,
        '300_1': { qRemaining: 5 } as never,
      },
      courseLookup: () => undefined,
      certainKeys: new Set(['100_1']),
    });
    expect(items[0]!.prob).toBe(1);
    expect(items[0]!.certain).toBe(true);
    expect(items[1]!.prob).toBeNull();
    expect(items[1]!.certain).toBeUndefined();
    expect(items[2]!.prob).toBe(1);
    expect(items[2]!.certain).toBeUndefined();
  });

  it('creditSimItems 非队列阶段忽略 certainKeys（走志愿级联）', () => {
    const c = {
      code: '1', seq: '1', name: '课', credits: 3, flag: 'bx', zy: 1,
      volRequired: '(0)5,5,5', volCapacity: 4, volApplied: 9,
    } as never;
    const items = creditSimItems([c], {
      isQueuePhase: false,
      queueDataMap: {},
      courseLookup: () => c,
      certainKeys: new Set(['1_1']),
    });
    expect(items[0]!.prob).toBeCloseTo(0.8);
    expect(items[0]!.certain).toBeUndefined();
  });
});

describe('草稿差量对齐', () => {
  it('重合课不动，只退多余选新增', () => {
    const sel = [
      { code: 'a', seq: '01', zy: 3, typeCode: '007' },
      { code: 'b', seq: '01', zy: 3, typeCode: '007' },
    ] as never;
    const draft: import('../src/lib/domain/types').DraftCourse[] = [
      { code: 'a', seq: '01', flag: 'rx', zy: 3, name: 'A', teacher: '', time: '', credits: 2, baseFlag: 'rx' },
      { code: 'c', seq: '01', flag: 'rx', zy: 3, name: 'C', teacher: '', time: '', credits: 2, baseFlag: 'rx' },
    ];
    const d = draftDiff(sel, draft);
    expect(d.toDrop.map((x) => x.code)).toEqual(['b']);
    expect(d.toAdd.map((x) => x.code)).toEqual(['c']);
    expect(d.kept.map((x) => x.code)).toEqual(['a']);
  });

  it('志愿不一致视为退+重选', () => {
    const sel = [{ code: 'a', seq: '01', zy: 1, typeCode: '007' }] as never;
    const draft: import('../src/lib/domain/types').DraftCourse[] = [{ code: 'a', seq: '01', flag: 'rx', zy: 3, name: 'A', teacher: '', time: '', credits: 2, baseFlag: 'rx' }];
    const d = draftDiff(sel, draft);
    expect(d.toDrop).toHaveLength(1);
    expect(d.toAdd).toHaveLength(1);
  });

  it('sameAsDraft 信息不全不认', () => {
    expect(sameAsDraft({ code: 'a', seq: '01', zy: 0, typeCode: '' } as never, { flag: 'rx', zy: 3 } as never)).toBe(false);
  });

  it('draftCourseFrom 携带 baseFlag 与 note', () => {
    const c = { code: '1', seq: '01', name: 'N', note: '周二 18:30', credits: 3, attr: '任选' } as never;
    const dc = draftCourseFrom(c, 'rx', 3, 'rx');
    expect(dc.note).toBe('周二 18:30');
    expect(dc.baseFlag).toBe('rx');
    expect(draftKeyOf(dc)).toBe('1_1');
  });
});

describe('mergeSelectedIntoDraft（已选载入）', () => {
  function makeDraft(courses: import('../src/lib/domain/types').DraftCourse[]): import('../src/lib/domain/types').Draft {
    return { id: 1, name: '草稿1', courses: [...courses], createdAt: 0 };
  }
  const sel = (code: string, seq: string, zy: number, typeCode = '007') =>
    ({ code, seq, zy, typeCode, name: code, teacher: '', time: '', credits: 2 }) as import('../src/lib/domain/types').Course;

  it('新行并入；已在稿行按服务端真实 zy 回写', () => {
    const draft = makeDraft([
      { code: 'a', seq: '01', flag: 'rx', zy: 3, name: 'A', teacher: '', time: '', credits: 2, baseFlag: 'rx' },
    ]);
    const ins = mergeSelectedIntoDraft(draft, [sel('a', '01', 1), sel('b', '01', 2)]);
    expect(ins).toEqual({ added: 1, skipped: 0, synced: 1 });
    expect(draft.courses).toHaveLength(2);
    expect(draft.courses[0]!.zy).toBe(1);
    expect(draft.courses[1]!.code).toBe('b');
    expect(draft.courses[1]!.zy).toBe(2);
  });

  it('zy=0（解析失败）不回写、不覆盖已有行；去重按 normSeq', () => {
    const draft = makeDraft([
      { code: 'a', seq: '01', flag: 'rx', zy: 2, name: 'A', teacher: '', time: '', credits: 2, baseFlag: 'rx' },
    ]);
    const ins = mergeSelectedIntoDraft(draft, [sel('a', '1', 0), sel('c', '1', 3)]);
    expect(ins).toEqual({ added: 1, skipped: 1, synced: 0 });
    expect(draft.courses[0]!.zy).toBe(2);
  });

  it('zy 相同视为跳过', () => {
    const draft = makeDraft([
      { code: 'a', seq: '01', flag: 'rx', zy: 3, name: 'A', teacher: '', time: '', credits: 2, baseFlag: 'rx' },
    ]);
    const ins = mergeSelectedIntoDraft(draft, [sel('a', '01', 3)]);
    expect(ins).toEqual({ added: 0, skipped: 1, synced: 0 });
  });

  it('已在稿行 flag 破损（不在 baseFlag 允许集）→ 顺手修复', () => {
    const draft = makeDraft([
      { code: 'a', seq: '01', flag: 'bx', zy: 3, name: 'A', teacher: '', time: '', credits: 2, baseFlag: 'rx' },
    ]);
    const ins = mergeSelectedIntoDraft(draft, [sel('a', '01', 3)]);
    expect(ins.skipped).toBe(0);
    expect(draft.courses[0]!.flag).toBe('rx');
  });

  it('已在稿行学分缺失 → 按服务端回填（形势与政策 0→1）', () => {
    const draft = makeDraft([
      { code: 'a', seq: '01', flag: 'bx', zy: 3, name: 'A', teacher: '', time: '', credits: 0, baseFlag: 'bx' },
    ]);
    const row = { ...sel('a', '01', 3, '006'), credits: 1 } as never;
    const ins = mergeSelectedIntoDraft(draft, [row]);
    expect(draft.courses[0]!.credits).toBe(1);
    expect(ins.synced).toBe(1);
  });

  it('候补行载入携带 queued 标记；转正后被清除', () => {
    const queued = { ...sel('b', '01', 3), isCandidate: true, selected: false } as never;
    const d1 = makeDraft([]);
    mergeSelectedIntoDraft(d1, [queued]);
    expect(d1.courses[0]!.queued).toBe(true);
    // 转正：selected=true（isCandidate 残留）→ 清 queued
    const promoted = { ...sel('b', '01', 3), isCandidate: true, selected: true } as never;
    const ins = mergeSelectedIntoDraft(d1, [promoted]);
    expect(d1.courses[0]!.queued).toBeUndefined();
    expect(ins.synced).toBe(1);
  });

  it('draftDiff：queued 行不参与差量提交', () => {
    const draft = makeDraft([
      { code: 'q', seq: '01', flag: 'rx', zy: 3, name: 'Q', teacher: '', time: '', credits: 2, baseFlag: 'rx', queued: true },
      { code: 'n', seq: '01', flag: 'rx', zy: 3, name: 'N', teacher: '', time: '', credits: 2, baseFlag: 'rx' },
    ]);
    const diff = draftDiff([], draft.courses);
    expect(diff.toAdd.map(c => c.code)).toEqual(['n']);
  });
});

describe('previewBlockMeta（WL 阶段徽章优先级）', () => {
  it('previewBlockMeta：课余量阶段草稿视图已选课显「已选」而非已满', async () => {
    const { previewBlockMeta } = await import('../src/lib/domain/preview');
    const c = { code: 'a', seq: '01', name: 'A', time: '', credits: 1 } as never;
    const m = previewBlockMeta(c, true, true, false, { a_1: { qRemaining: 0, qQueue: 3, qCapacity: 30 } }, undefined, null);
    expect(m.label).toBe('已选');
  });

  it('previewBlockMeta：当前已选视图中的候补行仍显排队名次（不被视图标志误判已选）', async () => {
    const { previewBlockMeta } = await import('../src/lib/domain/preview');
    const c = { code: 'b', seq: '01', name: 'B', time: '', credits: 1, queued: true } as never;
    const m = previewBlockMeta(c, true, false, true, { b_1: { qRemaining: 0, qQueue: 4, qCapacity: 30 } }, { myPos: 2, queueTotal: 9 } as never, null);
    expect(m.label).toBe('排队第2/9人');
  });
});

describe('draftCourseFromSelected / repairDraftCourse（flag 允许集约束）', () => {
  it('typeCode 缺失 + attr 缺失 → flag 落 baseFlag 兜底 rx 而非 bx', async () => {
    const { draftCourseFromSelected } = await import('../src/lib/domain/draft');
    const c = { code: 'a', seq: '01', name: 'A', teacher: '', time: '', credits: 2, zy: 1 } as never;
    const dc = draftCourseFromSelected(c);
    expect(dc.flag).toBe('rx');
    expect(dc.baseFlag).toBe('rx');
  });

  it('typeCode 006 + attr 必修 → flag bx（允许集内）', async () => {
    const { draftCourseFromSelected } = await import('../src/lib/domain/draft');
    const c = { code: 'a', seq: '01', name: 'A', typeCode: '006', attr: '必修', zy: 2 } as never;
    const dc = draftCourseFromSelected(c);
    expect(dc.flag).toBe('bx');
    expect(dc.baseFlag).toBe('bx');
  });

  it('repairDraftCourse：flag 越集归 baseFlag、zy 越界归 3', () => {
    const c: import('../src/lib/domain/types').DraftCourse = { code: 'a', seq: '01', name: 'A', teacher: '', time: '', credits: 0, flag: 'bx', zy: 0, baseFlag: 'rx' };
    expect(repairDraftCourse(c)).toBe(true);
    expect(c.flag).toBe('rx');
    expect(c.zy).toBe(3);
    expect(repairDraftCourse(c)).toBe(false);
    expect(c).toMatchObject({ flag: 'rx', zy: 3, baseFlag: 'rx' });
  });
});

describe('GBK 编码', () => {
  it('中文 → GBK 百分号', () => {
    // 高 = U+9AD8 → GBK B8 DF
    expect(gbkPercentEncode('高')).toBe('%B8%DF');
    expect(gbkPercentEncode('北京大学')).toBe('%B1%B1%BE%A9%B4%F3%D1%A7');
  });

  it('ASCII 直通、% 转义、表外字符回落', () => {
    expect(gbkPercentEncode('abcABC0123')).toBe('abcABC0123');
    expect(gbkPercentEncode('50%')).toBe('50%25');
    expect(gbkPercentEncode('😀')).toEqual(encodeURIComponent('😀'));
  });
});

describe('课表布局（多周段合并）', () => {
  it('同大节多周段合并为单块（each_key_duplicate 防护）', async () => {
    const courses = [
      { code: '1', seq: '01', name: '微积分', teacher: '甲', time: '1-2(1-9周),1-2(10-16周)', credits: 5 },
    ] as never;
    const { layoutPreview } = await import('../src/lib/domain/timetable-layout');
    const lay = layoutPreview(courses, () => ({ color: '', probLabel: '', bg: '' }));
    const keys = lay.blocks.map((b) => b.key + '_' + b.begin + '_' + b.end);
    expect(new Set(keys).size).toBe(keys.length);
    expect(lay.blocks).toHaveLength(1);
    expect(lay.blocks[0]!.when).toContain('1-16周');
  });
});

describe('工具', () => {
  it('normSeq 前导零归一', () => {
    expect(normSeq('01')).toBe('1');
    expect(normSeq('0')).toBe('0');
    expect(normSeq('')).toBe('0');
    expect(keyOf('10720011', '01')).toBe('10720011_1');
  });
});

describe('priProb / probGridData 优先任选档', () => {
  it('无优先通道 → 不显示优先格', () => {
    const c = { code: '1', seq: '1', name: 'x', volCapacity: 10, volOptional: '0,5,0' } as never;
    expect(priProb(c)).toBeNull();
    const rx = probGridData(c).find(r => r.flag === 'rx')!;
    expect(rx.cells).toHaveLength(3);
  });

  it('有优先通道 → rx 行最前加优先格（zy=0, pri=true）', () => {
    const c = { code: '1', seq: '1', name: 'x', volCapacity: 100, volRequired: '10,5,0', volElective: '5,0,0', volOptional: '(100)' } as never;
    expect(priProb(c)!.prob).toBeCloseTo(0.8);
    const rx = probGridData(c).find(r => r.flag === 'rx')!;
    expect(rx.cells[0]!.pri).toBe(true);
    expect(rx.cells[0]!.zy).toBe(0);
    expect(rx.cells).toHaveLength(4);
  });
});

describe('entryBaseFlag 入稿类型', () => {
  it('候补行无 attr 时按 typeCode 推导（不再一律回落任选）', () => {
    expect(entryBaseFlag({ code: '1', name: 'x', typeCode: '006' } as never)).toBe('bx');
    expect(entryBaseFlag({ code: '1', name: 'x', typeCode: '008' } as never)).toBe('xx');
    expect(entryBaseFlag({ code: '1', name: 'x', typeCode: '007' } as never)).toBe('rx');
  });
  it('attr 优先；体育/无信号兜底', () => {
    expect(entryBaseFlag({ code: '1', name: 'x', attr: '限选', typeCode: '006' } as never)).toBe('xx');
    expect(entryBaseFlag({ code: '1', name: 'x', typeLabel: '体育' } as never)).toBe('ty');
    expect(entryBaseFlag({ code: '1', name: 'x' } as never)).toBe('rx');
  });
});

describe('matchPoolRow 池行三段匹配', () => {
  const rows = [
    { code: '100', seq: '1', teacher: '甲' },
    { code: '100', seq: '2', teacher: '乙' },
    { code: '100', seq: '3', teacher: '甲、乙' },
  ] as never;
  it('归一课序精确（前导零）', () => {
    expect(matchPoolRow(rows, '02', '丙')!.seq).toBe('2');
    expect(matchPoolRow(rows, '01')!.seq).toBe('1');
  });
  it('课序无匹配 → 同课同师（多师行含单师）', () => {
    expect(matchPoolRow(rows, '9', '乙')!.seq).toBe('2');
    expect(matchPoolRow(rows, '9', '丙')).toBe(rows[0]);
  });
  it('teacherHit 只做正向包含', () => {
    expect(teacherHit(rows[2] as never, '乙')).toBe(true);
    expect(teacherHit(rows[1] as never, '甲乙')).toBe(false);
  });
  it('空行表', () => {
    expect(matchPoolRow([], '1')).toBeUndefined();
  });
});

describe('creditsOf 课号末位信用分', () => {
  it('纯数字课号恒取末位（本校课）', () => {
    expect(creditsOf('10680101', 9)).toBe(1);
    expect(creditsOf('20740012', 0)).toBe(2);
    expect(creditsOf('12345670', 5)).toBe(0);
  });
  it('外校前缀课号回退表内值', () => {
    expect(creditsOf('PK1001', 3)).toBe(3);
    expect(creditsOf('GPK2002', 2.5)).toBe(2.5);
    expect(creditsOf('BW001', undefined)).toBe(0);
    expect(creditsOf('', 4)).toBe(4);
    expect(creditsOf(null, 1)).toBe(1);
  });
});

describe('培养方案覆盖', () => {
  it('体育互认 + 英语(3) 二外替代', () => {
    const plan = [
      { semester: '', code: 'P1', name: '体育(1)', attr: '体育', credits: 1, group: '体育' },
      { semester: '', code: 'P2', name: '英语(3)', attr: '必修', credits: 2, group: '外语' },
    ];
    const pool = [
      { code: 'S1', seq: '1', name: '跆拳道(男)', attr: '体育', department: '体育部', selected: true },
      { code: 'X1', seq: '1', name: '第二外国语(日语)', attr: '任选', selected: true },
    ] as never;
    const cov = checkPlanCoverage(plan, pool, []);
    expect(cov[0]!.covered).toBe(true);
    expect(cov[1]!.coveredBy).toBe('(第二外国语替代)');
  });

  it('英语(1)(2) 不可由二外替代', () => {
    const plan = [{ semester: '', code: 'P3', name: '英语(1)', attr: '必修', credits: 2, group: '外语' }];
    const pool = [{ code: 'X1', seq: '1', name: '第二外国语(日语)', attr: '任选' }] as never;
    const cov = checkPlanCoverage(plan, pool, []);
    expect(cov[0]!.covered).toBe(false);
  });
});

describe('canAdjustZy（志愿档位上限；B1 尾项 keyOf 自排除）', () => {
  const sports = (v: Record<string, unknown>) => ({ name: '太极', typeLabel: '体育', typeCode: 'ty', ...v }) as never;

  it("同课班前导零拼写不占自己档位（'01' vs '1'）", () => {
    // 池内自己（seq '1'，志愿 2）在体育 2 志愿档（上限 1）；卡片是同一课班（seq '01'）
    const pool = [sports({ code: 'A', seq: '1', selected: true, zy: 2 })];
    const course = sports({ code: 'A', seq: '01', zy: 1 });
    expect(canAdjustZy(pool, course, 2, ZY_LIMITS)).toBe(true);
  });

  it('他课占满同档位仍拦截', () => {
    const pool = [sports({ code: 'B', seq: '1', selected: true, zy: 2 })];
    const course = sports({ code: 'A', seq: '01', zy: 1 });
    expect(canAdjustZy(pool, course, 2, ZY_LIMITS)).toBe(false);
  });

  it('必修 1 志愿上限 1：已有一门即拦截，改投 3 志愿放行', () => {
    const bx = (v: Record<string, unknown>) => ({ name: '高数', typeLabel: '必修', typeCode: '006', ...v }) as never;
    const pool = [bx({ code: 'A', seq: '1', selected: true, zy: 1 })];
    const course = bx({ code: 'B', seq: '1', zy: 2 });
    expect(canAdjustZy(pool, course, 1, ZY_LIMITS)).toBe(false);
    expect(canAdjustZy(pool, course, 3, ZY_LIMITS)).toBe(true);
  });
});

describe('cascadeOf 边界（B10 尾项）', () => {
  const c = (v: Record<string, unknown>) => v as never;

  it('无容量数据 → null', () => {
    expect(cascadeOf(c({ code: 'x', seq: '1', name: '课' }), 'bx', 1)).toBeNull();
    expect(cascadeOf(c({ code: 'x', seq: '1', name: '课', volCapacity: 0 }), 'bx', 1)).toBeNull();
  });

  it('体育按 volSports 拆档：prior 为低志愿之和，seats 截 0', () => {
    const ty = cascadeOf(c({ code: 'x', seq: '1', name: '太极', volCapacity: 10, volSports: '(1)2,4,5' }), 'ty', 2)!;
    expect(ty.pool).toBe(10);
    expect(ty.prior).toBe(2);
    expect(ty.peers).toBe(4);
    expect(ty.seats).toBe(8);
    expect(ty.hasVol).toBe(true);
  });

  it('必修 3 志愿：prior 为 1/2 志愿之和，seats = pool - prior', () => {
    const bx = cascadeOf(c({ code: 'x', seq: '1', name: '高数', volCapacity: 50, volRequired: '(1)15,20,25' }), 'bx', 3)!;
    expect(bx.prior).toBe(35);
    expect(bx.peers).toBe(25);
    expect(bx.seats).toBe(15);
  });

  it('prior 超池 → seats 截 0（不为负）', () => {
    const bx = cascadeOf(c({ code: 'x', seq: '1', name: '高数', volCapacity: 10, volRequired: '(1)15,20,25' }), 'bx', 3)!;
    expect(bx.seats).toBe(0);
  });
});

describe('creditDist（B10 尾项：伯努利卷积边界）', () => {
  const item = (credits: number, prob: number | null): never => ({ name: 'c', credits, prob, liveProb: prob }) as never;

  it('空池 → 单点 0 学分概率 1', () => {
    const d = creditDist([]);
    expect(d).toEqual({ points: [{ credits: 0, prob: 1 }], expected: 0, mode: 0, total: 0 });
  });

  it('概率 0 参与总学分但分布点仍在 0', () => {
    const d = creditDist([item(3, 0)]);
    expect(d.total).toBe(3);
    expect(d.expected).toBe(0);
    expect(d.points).toEqual([{ credits: 0, prob: 1 }]);
  });

  it('确定中签 → 期望=学分、众数=学分', () => {
    const d = creditDist([item(3, 1)]);
    expect(d.expected).toBe(3);
    expect(d.mode).toBe(3);
    expect(d.points).toEqual([{ credits: 3, prob: 1 }]);
  });

  it('两门独立卷积：四状态等权，expected=Σ p·学分，众数取最小并列', () => {
    const d = creditDist([item(3, 0.5), item(2, 0.5)]);
    expect(d.total).toBe(5);
    expect(d.points).toHaveLength(4);
    expect(d.points.map(p => p.credits)).toEqual([0, 2, 3, 5]);
    expect(d.expected).toBeCloseTo(2.5);
    expect(d.mode).toBe(0);
  });

  it('prob 非法（null / >1）与 0 学分条目被剔除', () => {
    const d = creditDist([item(3, null), item(0, 1), item(2, 1.5)]);
    expect(d).toEqual({ points: [{ credits: 0, prob: 1 }], expected: 0, mode: 0, total: 0 });
  });
});
