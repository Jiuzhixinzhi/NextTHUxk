// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课程池合并测试（入池/回填/容量刷新/借时间/队列回填/候补标记）
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { applyQueueToPool, hasParsedTime, markCandidates, mergeCandidateRows, mergePoolRows } from '../src/lib/domain/pool';
import type { Course } from '../src/lib/domain/types';

const c = (v: Record<string, unknown> = {}): Course =>
  ({ code: 'A', seq: '01', name: '甲课', credits: 3, ...v }) as unknown as Course;

const queueDatum = (qRemaining: number, qQueue: number, qCapacity = 40) => ({
  code: 'A',
  seq: '01',
  qRemaining,
  qQueue,
  qCapacity,
});

describe('hasParsedTime（时间可解析判定，池合并与预览共用）', () => {
  it('大节串或文字说明钟点任一可用即算可解析', () => {
    expect(hasParsedTime(c({ time: '1-2(1-16周)' }))).toBe(true);
    expect(hasParsedTime(c({ time: '', note: '周二 18:30-21:30(1-16周)' }))).toBe(true);
    expect(hasParsedTime(c({ time: '', xkTextNote: '周三 09:50-12:15' }))).toBe(true);
    expect(hasParsedTime(c({ time: '', note: '' }))).toBe(false);
  });
});

describe('mergePoolRows（搜索行入池）', () => {
  it('新课班入池并计入 added；同课号不同课序各自成行', () => {
    const pool: Course[] = [];
    const res = mergePoolRows(pool, [c({ code: 'A', seq: '01' }), c({ code: 'A', seq: '2' }), c({ code: 'B', seq: '0' })]);
    expect(res.added).toBe(3);
    expect(pool.map(x => x.seq)).toEqual(['01', '2', '0']);
  });

  it('课序前导零归一：01 与 1 视为同一课班，不重复入池', () => {
    const pool: Course[] = [c({ code: 'A', seq: '01', name: '旧名' })];
    const res = mergePoolRows(pool, [c({ code: 'A', seq: '1', teacher: '张三' })]);
    expect(res.added).toBe(0);
    expect(pool).toHaveLength(1);
    expect(pool[0]!.teacher).toBe('张三');
  });

  it('既有行只补空缺字段，不覆盖已有值', () => {
    const pool: Course[] = [c({ teacher: '原师', credits: 3, department: '计算机系' })];
    mergePoolRows(pool, [c({ teacher: '新师', credits: 4, department: '自动化系', note: '新说明' })]);
    expect(pool[0]).toMatchObject({ teacher: '原师', credits: 3, department: '计算机系', note: '新说明' });
  });

  it('未解析行被可解析行覆盖时间（not_parseable → time 真值）', () => {
    const pool: Course[] = [c({ time: '待定' })];
    mergePoolRows(pool, [c({ time: '1-2(1-16周)' })]);
    expect(pool[0]!.time).toBe('1-2(1-16周)');
  });

  it('容量/余量刷新：capacity>0 才动；余 0 是信息不是未知', () => {
    const pool: Course[] = [c({ capacity: 40, remaining: 7, available: true })];
    const res = mergePoolRows(pool, [c({ capacity: 40, remaining: 0 })]);
    expect(pool[0]).toMatchObject({ capacity: 40, remaining: 0, available: false });
    expect(res.filled).toBeGreaterThan(0);
    // 页签 0/0 占位不覆盖既有余量
    mergePoolRows(pool, [c({ capacity: 0, remaining: 0 })]);
    expect(pool[0]).toMatchObject({ capacity: 40, remaining: 0 });
  });

  it('借时间：同师行的时间/说明借给池内未解析的已选/候补行', () => {
    const pool: Course[] = [
      c({ code: 'A', seq: '02', teacher: '张三', selected: true, time: '' }),
      c({ code: 'A', seq: '04', teacher: '张三', isCandidate: true, time: '' }),
      c({ code: 'A', seq: '05', time: '' }), // 非已选/候补 → 不借
    ];
    mergePoolRows(pool, [c({ code: 'A', seq: '01', teacher: '张三', time: '1-2(1-16周)', note: '说明' })]);
    expect(pool[0]!.time).toBe('1-2(1-16周)');
    expect(pool[0]!.note).toBe('说明');
    expect(pool[1]!.time).toBe('1-2(1-16周)');
    expect(pool[1]!.xkTextNote).toBe('说明');
    expect(pool[2]!.time).toBe('');
  });

  it('形策式回归：同课号多班只借同课序，不借列表首项', () => {
    // 已选班 seq 02 时间缺失；干扰班（列表首项）seq 01 与正确班 seq 02 同批到达
    const pool: Course[] = [c({ code: 'A', seq: '02', selected: true, time: '' })];
    mergePoolRows(pool, [
      c({ code: 'A', seq: '01', time: '4-6(1-8周),5-6(4周)' }),
      c({ code: 'A', seq: '02', time: '4-6(1-8周),2-4(5周)' }),
    ]);
    expect(pool[0]!.time).toBe('4-6(1-8周),2-4(5周)');
  });

  it('同课号多班且无课序/教师匹配 → 不盲借首行（宁缺勿错）', () => {
    const pool: Course[] = [c({ code: 'A', seq: '09', selected: true, time: '' })];
    mergePoolRows(pool, [c({ code: 'A', seq: '01', time: '4-6(1-8周),5-6(4周)' })]);
    expect(pool[0]!.time).toBe('');
  });

  it('可解析行回调一次（供调用方写 knote 时间记忆）', () => {
    const seen: string[] = [];
    mergePoolRows([], [c({ time: '1-2(1-16周)' }), c({ time: '', note: '' }), c({ time: '', note: '周一 08:00-09:35' })], r => seen.push(r.seq));
    expect(seen).toEqual(['01', '01']);
  });

  it('空输入短路', () => {
    expect(mergePoolRows([], [])).toEqual({ added: 0, filled: 0 });
  });
});

describe('applyQueueToPool（队列余量回填）', () => {
  it('命中行写 available/remaining/capacity；余 0 不覆盖 remaining', () => {
    const pool: Course[] = [c({ capacity: 40, remaining: 9, available: true }), c({ code: 'B', seq: '01' })];
    applyQueueToPool(pool, { A_1: queueDatum(0, 5) });
    expect(pool[0]).toMatchObject({ available: false, remaining: 9, capacity: 40 });
    expect(pool[1]!.available).toBeUndefined();
    expect(pool[1]!.remaining).toBeUndefined();
  });

  it('余量 >0 时同步 remaining', () => {
    const pool: Course[] = [c()];
    applyQueueToPool(pool, { A_1: queueDatum(7, 0) });
    expect(pool[0]).toMatchObject({ available: true, remaining: 7, capacity: 40 });
  });
});

describe('markCandidates / mergeCandidateRows（候补标记与并入）', () => {
  it('标记按权威名单重写（名单外的清除），课序前导零归一', () => {
    const pool: Course[] = [c({ code: 'A', seq: '01', isCandidate: true }), c({ code: 'B', seq: '01', isCandidate: true })];
    markCandidates(pool, [c({ code: 'A', seq: '1' })]);
    expect(pool[0]!.isCandidate).toBe(true);
    expect(pool[1]!.isCandidate).toBe(false);
  });

  it('候补并入：池中已有同课班不重复；新候补补 isCandidate 行', () => {
    const pool: Course[] = [c({ code: 'A', seq: '01' })];
    const added = mergeCandidateRows(pool, [c({ code: 'A', seq: '1', isCandidate: true }), c({ code: 'B', seq: '02' })]);
    expect(added).toBe(1);
    expect(pool).toHaveLength(2);
    expect(pool[1]).toMatchObject({ code: 'B', seq: '02', isCandidate: true });
  });
});
