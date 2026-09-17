// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 预览行合成测试（previewJoinRows：借池行/knote 的 time+note）
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { previewJoinRows, previewBlockMeta } from '../src/lib/domain/preview';
import type { Course } from '../src/lib/domain/types';

const c = (v: Record<string, unknown>): Course => ({ code: 'A', seq: '01', name: '甲', credits: 3, ...v }) as unknown as Course;

describe('previewJoinRows（已选/候补/草稿行借时间）', () => {
  it('时间可解析的行原样返回（不走 join）', () => {
    const row = c({ time: '1-2(1-16周)' });
    const out = previewJoinRows([row], [], {});
    expect(out).toEqual([row]);
    expect(out[0]).toBe(row);
  });

  it('未解析行借同课号池行的 time/note（并补 xkTextNote）', () => {
    const row = c({ seq: '01', time: '' });
    const pool = [c({ seq: '01', time: '2-3(1-16周)', note: '周三 09:50-12:15' })];
    const out = previewJoinRows([row], pool, {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ time: '2-3(1-16周)', note: '周三 09:50-12:15', xkTextNote: '周三 09:50-12:15' });
    expect(out[0]).not.toBe(row); // 合成新行，不改动原引用
    expect(row.time).toBe('');
  });

  it('同课号多班按课序选对班（不借错时间）', () => {
    const row = c({ seq: '02', time: '' });
    const pool = [c({ seq: '01', time: '1-2(1-16周)' }), c({ seq: '02', time: '3-4(1-16周)' })];
    const out = previewJoinRows([row], pool, {});
    expect(out[0]!.time).toBe('3-4(1-16周)');
  });

  it('课序缺位时回退同课同师匹配', () => {
    const row = c({ seq: '', teacher: '张三', time: '' });
    const pool = [c({ seq: '01', teacher: '李四', time: '1-2(1-16周)' }), c({ seq: '09', teacher: '张三', time: '5-6(1-16周)' })];
    const out = previewJoinRows([row], pool, {});
    expect(out[0]!.time).toBe('5-6(1-16周)');
  });

  it('池内无可解析行 → 借 knote 时间记忆', () => {
    const row = c({ code: 'B', seq: '01', time: '' });
    const knote = { B_1: { note: '周二 18:30-21:30', time: '' } };
    const out = previewJoinRows([row], [], knote);
    expect(out[0]!.note).toBe('周二 18:30-21:30');
    expect(out[0]!.xkTextNote).toBe('周二 18:30-21:30');
  });

  it('knote 命中按归一课班键（课序前导零差异仍命中）', () => {
    const row = c({ code: 'B', seq: '03', time: '' });
    const knote = { B_3: { note: '周二 18:30-21:30', time: '' } };
    const out = previewJoinRows([row], [], knote);
    expect(out[0]!.note).toBe('周二 18:30-21:30');
    expect(out[0]!.xkTextNote).toBe('周二 18:30-21:30');
  });

  it('knote 不跨课序借（同课号不同班 → 原样缺省）', () => {
    const row = c({ code: 'B', seq: '3', time: '' });
    const knote = { B_7: { note: '周四 08:00-09:35', time: '' } };
    const out = previewJoinRows([row], [], knote);
    expect(out[0]!.note).toBeUndefined();
  });

  it('无池行无 knote → 原样返回（诚实缺省）', () => {
    const row = c({ time: '' });
    const out = previewJoinRows([row], [], {});
    expect(out).toEqual([row]);
  });

  it("按 keyOf 去重：'01'/'1' 同课班只保留一行", () => {
    const out = previewJoinRows([c({ seq: '01', time: '1-2(1-16周)' }), c({ seq: '1', time: '1-2(1-16周)' })], [], {});
    expect(out).toHaveLength(1);
  });

  it('池内无可解析行时退到同课号任意行兜底（可能借到未解析时间）', () => {
    const row = c({ time: '' });
    const out = previewJoinRows([row], [c({ time: '待定' })], {});
    expect(out[0]!.time).toBe('待定');
  });
});

describe('previewBlockMeta（课表块元数据口径）', () => {
  const qd = (qRemaining: number, qQueue: number) => ({ A_1: { code: 'A', seq: '01', qRemaining, qQueue, qCapacity: 30 } });

  it('已选优先于余量：课余量阶段已选课显「已选」', () => {
    expect(previewBlockMeta(c({}), true, true, false, qd(0, 3), undefined, null).label).toBe('已选');
  });

  it('候补行显排队名次（不被视图标志误判已选）', () => {
    const m = previewBlockMeta(c({}), true, false, true, qd(0, 4), c({ myPos: 2, queueTotal: 9 }), null);
    expect(m.label).toBe('排队第2/9人');
    expect(m.color).toBe('#ff9f1a');
  });

  it('自定义占用固定紫色块', () => {
    const m = previewBlockMeta(c({ manual: true, code: 'manual-1' }), false, false, false, {}, undefined, null);
    expect(m.label).toBe('自定义');
  });

  it('预选阶段走概率色', () => {
    const m = previewBlockMeta(c({}), false, false, false, {}, undefined, { color: '#07c160', label: '80%', bg: 'rgba(7,193,96,.14)' });
    expect(m).toEqual({ color: '#07c160', label: '80%', bg: 'rgba(7,193,96,.14)' });
  });
});
