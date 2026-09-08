// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 域逻辑测试：时间解析 / 冲突 / 概率 / 草稿差量 / GBK
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { parseTimeSlots, clockRangesOf, pvToMin, spansOf } from '../src/lib/domain/time';
import { detectConflicts } from '../src/lib/domain/conflict';
import { calcProb, parseVolArr, probResult, creditDist, creditSimItems } from '../src/lib/domain/probability';
import { draftDiff, draftCourseFrom, draftKeyOf, mergeSelectedIntoDraft, repairDraftCourse, sameAsDraft } from '../src/lib/domain/draft';
import { gbkPercentEncode } from '../src/lib/net/gbk';
import { normSeq, keyOf } from '../src/lib/core/utils';
import { checkPlanCoverage } from '../src/lib/domain/plancov';

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
