// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 更新/志愿检查点窗口测试（B10 尾项）
// 锁死：nextVolCheckpoint 严格向后（恰在检查点则取下一个）；volWindowStart 取
// 最近一个 ≤ now（今日未到则回卷昨日末档）；volNeedsRefresh「过期→true」。
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it, vi } from 'vitest';

// update/check 顶层 import storage（读取 chrome.storage.local）——node 测试环境需先垫桩。
// 仅测窗口纯函数，不触碰 store 读写，空对象即可。
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).chrome = { storage: { local: {} } };
});

import { nextVolCheckpoint, volNeedsRefresh, volWindowStart } from '../src/lib/update/check';

/** 相对今天（本地时区）的某时刻 */
const at = (h: number, m = 0, dayOffset = 0): Date => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
};

describe('nextVolCheckpoint（每日 8/12/16/20 检查点）', () => {
  it('未到首检查点 → 当日 8 点', () => {
    expect(nextVolCheckpoint(at(7).getTime()).getTime()).toBe(at(8).getTime());
    expect(nextVolCheckpoint(at(0).getTime()).getTime()).toBe(at(8).getTime());
  });

  it('档间 → 下一个档位', () => {
    expect(nextVolCheckpoint(at(9).getTime()).getTime()).toBe(at(12).getTime());
    expect(nextVolCheckpoint(at(16, 30).getTime()).getTime()).toBe(at(20).getTime());
  });

  it('恰在检查点 → 严格向后取下一档（不返回自身）', () => {
    expect(nextVolCheckpoint(at(8).getTime()).getTime()).toBe(at(12).getTime());
    expect(nextVolCheckpoint(at(20).getTime()).getTime()).toBe(at(8, 0, 1).getTime());
  });

  it('过末档 → 次日 8 点', () => {
    expect(nextVolCheckpoint(at(20, 30).getTime()).getTime()).toBe(at(8, 0, 1).getTime());
    expect(nextVolCheckpoint(at(23, 59).getTime()).getTime()).toBe(at(8, 0, 1).getTime());
  });
});

describe('volWindowStart（最近一个 ≤ now 的检查点）', () => {
  it('档内 → 本档起点', () => {
    expect(volWindowStart(at(9).getTime()).getTime()).toBe(at(8).getTime());
    expect(volWindowStart(at(20, 30).getTime()).getTime()).toBe(at(20).getTime());
  });

  it('恰在检查点 → 该检查点（d >= t）', () => {
    expect(volWindowStart(at(8).getTime()).getTime()).toBe(at(8).getTime());
    expect(volWindowStart(at(20).getTime()).getTime()).toBe(at(20).getTime());
  });

  it('未到首档 → 回卷昨日末档 20 点', () => {
    expect(volWindowStart(at(7).getTime()).getTime()).toBe(at(20, 0, -1).getTime());
    expect(volWindowStart(at(0).getTime()).getTime()).toBe(at(20, 0, -1).getTime());
  });
});

describe('volNeedsRefresh（过期 → true；判定一律正向，禁双重否定）', () => {
  it('缺时间戳（0）保守判过期', () => {
    expect(volNeedsRefresh(0)).toBe(true);
  });

  it('窗口起点及之后 → 新鲜（false）', () => {
    const ws = volWindowStart().getTime();
    expect(volNeedsRefresh(ws)).toBe(false);
    expect(volNeedsRefresh(ws + 1)).toBe(false);
    expect(volNeedsRefresh(Date.now())).toBe(false);
  });

  it('窗口起点之前 → 过期（true）', () => {
    const ws = volWindowStart().getTime();
    expect(volNeedsRefresh(ws - 1)).toBe(true);
  });
});
