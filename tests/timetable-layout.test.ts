// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课表预览布局测试：占用覆盖层（不挤占课程分道）+ overlap 标记
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { layoutPreview } from '../src/lib/domain/timetable-layout';
import type { Course, ManualEvent } from '../src/lib/domain/types';

const metaOf = () => ({ color: '', probLabel: '', bg: '' });

const course = (code: string, time: string): Course => ({
  code,
  seq: '0',
  name: '课' + code,
  time,
});

const me = (id: number, day: number, begin: string, end: string): ManualEvent => ({
  id,
  name: '例会' + id,
  code: 'manual-' + id,
  seq: '0',
  day,
  begin,
  end,
  time: '',
  manual: true,
  credits: 0,
});

describe('layoutPreview 占用覆盖层', () => {
  it('占用与课程重叠：课程保持全宽（lanes=1），占用不分道且 overlap=true', () => {
    // 周一 3-4节（09:50-12:15）+ 周一 10:00-11:00 占用
    const layout = layoutPreview([course('A', '1-2(全周)'), me(1, 1, '10:00', '11:00')], metaOf);
    const cb = layout.blocks.find((b) => b.code === 'A')!;
    const mb = layout.blocks.find((b) => b.manual)!;
    expect(cb.lanes).toBe(1);
    expect(mb.lanes).toBe(1);
    expect(mb.lane).toBe(0);
    expect(mb.overlap).toBe(true);
  });

  it('占用无重叠（同日不相交 / 异日同时段）：overlap=false', () => {
    const layout = layoutPreview(
      [course('A', '1-2(全周)'), me(1, 1, '13:00', '14:00'), me(2, 2, '10:00', '11:00')],
      metaOf,
    );
    const m1 = layout.blocks.find((b) => b.id === 1)!;
    const m2 = layout.blocks.find((b) => b.id === 2)!;
    expect(m1.overlap).toBe(false);
    expect(m2.overlap).toBe(false);
  });

  it('占用彼此重叠仍互相分道，且不影响课程分道', () => {
    const layout = layoutPreview(
      [course('A', '1-2(全周)'), me(1, 1, '10:00', '11:30'), me(2, 1, '10:30', '12:00')],
      metaOf,
    );
    const cb = layout.blocks.find((b) => b.code === 'A')!;
    expect(cb.lanes).toBe(1);
    const m1 = layout.blocks.find((b) => b.id === 1)!;
    const m2 = layout.blocks.find((b) => b.id === 2)!;
    expect(m1.lanes).toBe(2);
    expect(m2.lanes).toBe(2);
    expect(m1.lane).not.toBe(m2.lane);
    expect(m1.overlap).toBe(true);
    expect(m2.overlap).toBe(true);
  });

  it('两门重叠课程照常分道（lanes=2），占用仅作覆盖层', () => {
    const layout = layoutPreview(
      [course('A', '1-2(全周)'), course('B', '1-2(全周)'), me(1, 1, '10:00', '11:00')],
      metaOf,
    );
    const lanes = layout.blocks.filter((b) => !b.manual).map((b) => b.lanes);
    expect(lanes).toEqual([2, 2]);
    const mb = layout.blocks.find((b) => b.manual)!;
    expect(mb.lanes).toBe(1);
    expect(mb.overlap).toBe(true);
  });

  it('边界相接不算重叠（开区间判定）', () => {
    // 课程 09:50-12:15，占用 12:15-13:00 恰好衔接
    const layout = layoutPreview([course('A', '1-2(全周)'), me(1, 1, '12:15', '13:00')], metaOf);
    const mb = layout.blocks.find((b) => b.manual)!;
    expect(mb.overlap).toBe(false);
  });
});

describe('layoutPreview 块键（day/tag 维度）', () => {
  it('同一大节跨两日 → 两块，且各自的 when 只含自己那天', () => {
    // 周一第2大节 + 周三第2大节（time 串 day-大节：1-2=周一第2大节，slot 名 '3-4节'）
    // slot 同名，旧键（无 day）会被 merged 并成一块、丢掉周三
    const layout = layoutPreview([course('A', '1-2(全周),3-2(全周)')], metaOf);
    const blocks = layout.blocks.filter((b) => !b.manual);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.day).sort()).toEqual([1, 3]);
    expect(blocks.find((b) => b.day === 1)!.when).toBe('1-3-4节(全周)');
    expect(blocks.find((b) => b.day === 3)!.when).toBe('3-3-4节(全周)');
  });

  it('拆周段仍是同一块（when 文本并集，回归保护）', () => {
    const layout = layoutPreview([course('A', '1-2(1-8周),1-2(10-16周)')], metaOf);
    const blocks = layout.blocks.filter((b) => !b.manual);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.when).toContain('1-8周');
    expect(blocks[0]!.when).toContain('10-16周');
  });

  it('外校课复合日钟点（周二、周四同钟点）→ 两块，day 2 与 day 4', () => {
    const ext: Course = { code: 'PK10001', seq: '1', name: '外校课', time: '', note: '周二、周四 15:00-16:30' };
    const layout = layoutPreview([ext], metaOf);
    const blocks = layout.blocks.filter((b) => !b.manual);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.day).sort()).toEqual([2, 4]);
    expect(layout.undet).toHaveLength(0);
  });

  it('同日两段钟点 → 两块且分道不互相覆盖', () => {
    const ext: Course = { code: 'PK10002', seq: '1', name: '外校课', time: '', note: '周二 08:00-09:35;周二 15:00-16:30' };
    const layout = layoutPreview([ext], metaOf);
    const blocks = layout.blocks.filter((b) => !b.manual);
    expect(blocks).toHaveLength(2);
    expect(new Set(blocks.map((b) => b.when)).size).toBe(2);
  });
});

describe('layoutPreview 块元数据（学分 / 周次标注）', () => {
  it('学分进块；仅非全周/1-16周标注周次', () => {
    const rows: Course[] = [
      { code: 'A', seq: '1', name: '甲', credits: 4, teacher: '张三', time: '1-2(1-8周)' },
      { code: 'B', seq: '1', name: '乙', credits: 3, time: '1-2(全周)' },
      { code: 'C', seq: '1', name: '丙', credits: 2, time: '3-2(1-16周)' },
    ];
    const layout = layoutPreview(rows, metaOf);
    const bA = layout.blocks.find((b) => b.code === 'A')!;
    expect(bA.credits).toBe(4);
    expect(bA.teacher).toBe('张三');
    expect(bA.week).toBe('1-8周');
    expect(layout.blocks.find((b) => b.code === 'B')!.week).toBe('');
    expect(layout.blocks.find((b) => b.code === 'C')!.week).toBe('');
  });
});
