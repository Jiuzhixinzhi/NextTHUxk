// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 概率趋势历史域测试：窗口快照 / 合并 / 重算 / 趋势差
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import {
  MAX_HIST_WINDOWS,
  mergeWindow,
  probAt,
  probSeries,
  probYDomain,
  snapshotVolMap,
  sparkPath,
  trendDelta,
  type VolHistMap,
  type VolPoint,
} from '../src/lib/domain/probhist';
import { calcProb } from '../src/lib/domain/probability';

const W = (t: number, cap: number, vr = '', vx = '', vo = '', vs = ''): VolPoint => ({ t, cap, vr, vx, vo, vs });

describe('snapshotVolMap（快照）', () => {
  it('key 归一（前导零课序）并只收有数据行（墓碑行剔除）', () => {
    const map = snapshotVolMap(
      {
        '10760031_01': { code: '10760031', seq: '01', capacity: 30, applied: 20, volRequired: '(1)1,2,3' },
        '10760032_1': { code: '10760032', seq: '1', capacity: 0, applied: 0, volOptional: '' },
      } as never,
      111,
    );
    expect(Object.keys(map)).toEqual(['10760031_1']);
    expect(map['10760031_1']![0]).toEqual({ t: 111, cap: 30, vr: '(1)1,2,3', vx: '', vo: '', vs: '' });
  });

  it('空 map → 空', () => {
    expect(snapshotVolMap({}, 0)).toEqual({});
  });
});

describe('mergeWindow（窗口合并）', () => {
  it('新窗口追加（时间升序）', () => {
    const hist: VolHistMap = {};
    expect(mergeWindow(hist, { k: [W(100, 30, '(1)3,2,1')] })).toBe(true);
    expect(mergeWindow(hist, { k: [W(200, 30, '(1)5,2,1')] })).toBe(true);
    expect(hist['k']).toHaveLength(2);
    expect(hist['k']![1]!.vr).toBe('(1)5,2,1');
  });

  it('同窗口替换（后到修正）、完全相同幂等不写、乱序按 t 插入', () => {
    const hist: Record<string, VolPoint[]> = { k: [W(100, 30, '(1)3,2,1')] };
    expect(mergeWindow(hist, { k: [W(999, 30, '(1)3,2,1')] })).toBe(true); // t 不同 → 新点
    expect(hist['k']).toHaveLength(2);
    // 乱序补插：t=100 已在序中 → 同窗且相同数据：幂等
    expect(mergeWindow(hist, { k: [W(100, 30, '(1)3,2,1')] })).toBe(false);
    expect(hist['k']).toHaveLength(2);
    // 同窗数据更新：替换（不留乱序点）
    expect(mergeWindow(hist, { k: [W(999, 30, '(1)4,2,1')] })).toBe(true);
    expect(hist['k']![1]!.vr).toBe('(1)4,2,1');
    expect(hist['k']).toHaveLength(2);
    // 乱序补插：t=150 居两窗之间
    expect(mergeWindow(hist, { k: [W(150, 30, '(1)5,2,1')] })).toBe(true);
    expect(hist['k']!.map(p => p.t)).toEqual([100, 150, 999]);
  });

  it('超上限截断（保留最近 MAX_HIST_WINDOWS）', () => {
    const hist: Record<string, VolPoint[]> = {};
    for (let i = 0; i < MAX_HIST_WINDOWS + 5; i++) mergeWindow(hist, { k: [W(i * 100, 30, '(1)1,1,1')] });
    expect(hist['k']).toHaveLength(MAX_HIST_WINDOWS);
    expect(hist['k']![0]!.t).toBe(5 * 100);
    expect(hist['k']![hist['k']!.length - 1]!.t).toBe((MAX_HIST_WINDOWS + 4) * 100);
  });
});

describe('probAt（快照重算，与 calcProb 同口径）', () => {
  it('级联：bx 第1志愿 = 剩余池/同志愿', () => {
    const p = W(0, 5, '(1)1,29,0');
    const direct = calcProb(
      { code: '', seq: '0', volCapacity: 5, volRequired: '(1)1,29,0' } as never,
      'bx',
      2,
    );
    expect(probAt(p, 'bx', 2)).toEqual(direct);
  });

  it('rx 优先扣除且类型串缺 → 无数据', () => {
    expect(probAt(W(0, 10, '', '', '(1)0,5,0'), 'rx', 1).prob).toBe(1);
    expect(probAt(W(0, 10, '', '', '(1)0,5,0'), 'bx', 1).prob).toBe(-1);
  });

  it('体育 vs 串（priority 仅 rx 使用）', () => {
    const p = probAt(W(0, 4, '', '', '', '(2)2,3,0'), 'ty', 2);
    expect(p.prob).toBeCloseTo(2 / 3);
    expect(p.ratioLabel).toBe('3/2');
  });
});

describe('probSeries / trendDelta', () => {
  it('只保留有效点（无数据剔除）', () => {
    const pts = [W(100, 10, '(1)0,0,0'), W(200, 10, '(1)1,0,0'), W(300, 10, '', '', '', '')];
    const s = probSeries(pts, 'bx', 1);
    expect(s).toHaveLength(2);
    expect(s[0]!.t).toBe(100);
  });

  it('trendDelta = 当前 − 上一有效窗口（百分点）', () => {
    expect(trendDelta([W(100, 10, '(1)20,0,0'), W(200, 10, '(1)10,0,0')], 'bx', 1)).toBe(50);
    expect(trendDelta([W(100, 10, '(1)10,0,0'), W(200, 10, '(1)20,0,0')], 'bx', 1)).toBe(-50);
    expect(trendDelta([W(100, 10, '(1)5,0,0')], 'bx', 1)).toBeNull();
    expect(trendDelta(undefined, 'bx', 1)).toBeNull();
    expect(trendDelta([W(100, 10, '', '', '', '')], 'bx', 1)).toBeNull(); // 全程无数据
  });
});

describe('sparkPath（SVG 折线）', () => {
  it('<2 点 → null', () => {
    expect(sparkPath([{ t: 0, prob: 1 }], 100, 40)).toBeNull();
    expect(sparkPath([], 100, 40)).toBeNull();
  });

  it('x 随时间递增；概率走高 → y 减小', () => {
    const s = probSeries([W(100, 10, '(1)20,0,0'), W(200, 10, '(1)10,0,0')], 'bx', 1);
    const path = sparkPath(s, 100, 40, 4)!;
    const pts: number[][] = path.split(' ').map(p => p.split(',').map(Number));
    expect(pts[0]![0]!).toBeLessThan(pts[1]![0]!);
    expect(pts[0]![1]!).toBeGreaterThan(pts[1]![1]!);
  });

  it('传入 [yMin,yMax] → y 按域缩放（默认 0-1 域名拆分）', () => {
    const p = sparkPath([{ t: 0, prob: 0.6 }, { t: 1, prob: 0.7 }], 100, 40, 4, 0.5, 0.8)!;
    const pts: number[][] = p.split(' ').map(q => q.split(',').map(Number));
    expect(pts[0]![1]!).toBeCloseTo(25.3, 1); // 36 - (0.1/0.3)*32
    expect(pts[1]![1]!).toBeCloseTo(14.7, 1); // 36 - (0.2/0.3)*32
    expect(pts[1]![1]!).toBeLessThan(pts[0]![1]!);
  });
});

describe('probYDomain（动态 y 域）', () => {
  it('min/max ±15% padding（max(ratio, 0.02)），不夹紧时原样', () => {
    const [lo, hi] = probYDomain([{ t: 0, prob: 0.6 }, { t: 1, prob: 0.72 }]);
    expect(lo).toBeCloseTo(0.58, 5); // 0.6 - 0.02（ratio=0.018 < 0.02）
    expect(hi).toBeCloseTo(0.74, 5); // 0.72 + 0.02
  });

  it('越界夹紧 [0,1]', () => {
    const [lo, hi] = probYDomain([{ t: 0, prob: 0.01 }, { t: 1, prob: 0.1 }]);
    expect(lo).toBe(0); // 0.01 - 0.02 → 负 → 0
    expect(hi).toBeCloseTo(0.12, 5);
    const [lo2, hi2] = probYDomain([{ t: 0, prob: 0.9 }, { t: 1, prob: 0.99 }]);
    expect(lo2).toBeCloseTo(0.88, 5);
    expect(hi2).toBe(1); // 0.99 + 0.02 → 超 → 1
  });

  it('扁平序列（差<1 百分点）退化为值 ±5% 区间', () => {
    const [lo, hi] = probYDomain([{ t: 0, prob: 0.5 }, { t: 1, prob: 0.505 }]);
    expect(lo).toBeCloseTo(0.4525, 5); // 均值 0.5025 - 0.05
    expect(hi).toBeCloseTo(0.5525, 5); // 均值 0.5025 + 0.05
  });

  it('空序列 → [0,1]', () => {
    expect(probYDomain([])).toEqual([0, 1]);
  });
});
