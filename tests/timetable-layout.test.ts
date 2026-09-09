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
