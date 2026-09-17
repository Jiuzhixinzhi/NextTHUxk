// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 回填引擎纯核测试（B3 守门）
// 锁死：前台让路不耗预算；前台中途接手判跳过（非未命中）；预算恰在发请求前消耗；
// 三段匹配挑对班；批式（batch+gap）/池式（concurrency+stagger）两种步调原样。
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { backfillBatched, backfillPooled, runBackfillRow } from '../src/lib/domain/backfill';
import type { Course } from '../src/lib/domain/types';

const c = (v: Record<string, unknown> = {}): Course => ({ code: 'A', seq: '01', name: '甲课', ...v }) as unknown as Course;

const noSleep = async () => {};

describe('runBackfillRow（单行回填）', () => {
  it('前台占用：跳过且不耗预算、不发探查', async () => {
    let consumed = 0;
    let probed = 0;
    const res = await runBackfillRow(c(), {
      pauseGate: () => true,
      consume: () => consumed++,
      probe: async () => {
        probed++;
        return [];
      },
      applyHit: () => {
        throw new Error('不可达');
      },
    });
    expect(res).toEqual({ kind: 'skip' });
    expect(consumed).toBe(0);
    expect(probed).toBe(0);
  });

  it('前台中途接手：探到 0 行且此刻占用 → 判跳过（预算已耗，不判未命中）', async () => {
    let busy = false;
    let consumed = 0;
    const res = await runBackfillRow(c(), {
      pauseGate: () => busy,
      consume: () => consumed++,
      probe: async () => {
        busy = true;
        return [];
      },
      applyHit: () => {
        throw new Error('不可达');
      },
    });
    expect(res).toEqual({ kind: 'skip' });
    expect(consumed).toBe(1);
  });

  it('预算恰在发请求前消耗（探查抛错也已计数）', async () => {
    const consumed: string[] = [];
    await expect(
      runBackfillRow(c(), {
        pauseGate: () => false,
        consume: k => consumed.push(k),
        probe: () => Promise.reject(new Error('网络死页')),
        applyHit: () => {},
      }),
    ).rejects.toThrow('网络死页');
    expect(consumed).toEqual(['A_1']);
  });

  it('命中：归一课序挑对班（01 命中 seq 1 的行），applyHit 收到命中行', async () => {
    const hit = c({ seq: '1', time: '1-2(1-16周)' });
    const decoy = c({ seq: '2', time: '3-4(1-16周)' });
    const applied: Course[] = [];
    const res = await runBackfillRow(c({ seq: '01' }), {
      pauseGate: () => false,
      probe: async () => [decoy, hit],
      applyHit: (r, h) => applied.push(r, h),
    });
    expect(res).toEqual({ kind: 'hit' });
    expect(applied[1]).toBe(hit);
  });

  it('未命中（严格同课号口径）：无同课号行即未命中，返回搜到行数', async () => {
    const res = await runBackfillRow(c(), {
      pauseGate: () => false,
      probe: async () => [c({ code: 'B' }), c({ code: 'B', seq: '2' })],
      applyHit: () => {
        throw new Error('不可达');
      },
      strictSameCode: true,
    });
    expect(res).toEqual({ kind: 'miss', rowsFound: 2 });
  });

  it('未命中（候补回填口径）：无同课号行时回退全行三段匹配取首行', async () => {
    const applied: Course[] = [];
    const res = await runBackfillRow(c({ seq: '9' }), {
      pauseGate: () => false,
      probe: async () => [c({ code: 'B', seq: '9', credits: 3 })],
      applyHit: (r, h) => applied.push(r, h),
    });
    expect(res).toEqual({ kind: 'hit' });
    expect(applied[1]!.credits).toBe(3);
  });
});

describe('backfillBatched（已选回填步调：批并发 + 批间 gap）', () => {
  it('7 行批 5：两批并发边界 5+2，gap 睡 1 次（批间才睡）', async () => {
    let inflight = 0;
    let peak = 0;
    const gaps: number[] = [];
    const rows = Array.from({ length: 7 }, (_, i) => c({ code: 'A' + i }));
    const outcomes: string[] = [];
    await backfillBatched(
      rows,
      {
        pauseGate: () => false,
        probe: async () => {
          inflight++;
          peak = Math.max(peak, inflight);
          await Promise.resolve();
          inflight--;
          return [c({ code: 'X' })];
        },
        applyHit: () => {},
      },
      {
        batch: 5,
        gapMs: 60,
        sleepFn: async ms => {
          gaps.push(ms);
        },
        onOutcome: (r, res) => outcomes.push(r.code + ':' + res.kind),
      },
    );
    expect(peak).toBe(5);
    expect(gaps).toEqual([60]);
    expect(outcomes.every(x => x.endsWith(':hit'))).toBe(true);
    expect(outcomes).toHaveLength(7);
  });

  it('单行抛错不炸整批：onError 接住、其余行照常', async () => {
    const outcomes: string[] = [];
    const errors: string[] = [];
    await backfillBatched(
      [c({ code: 'A' }), c({ code: 'B' }), c({ code: 'C' })],
      {
        pauseGate: () => false,
        probe: async r => {
          if (r.code === 'B') throw new Error('死页');
          return [c({ code: 'X' })];
        },
        applyHit: () => {},
      },
      {
        batch: 3,
        gapMs: 0,
        sleepFn: noSleep,
        onOutcome: (r, res) => outcomes.push(r.code + res.kind),
        onError: (r, e) => errors.push(r.code + String((e as Error).message)),
      },
    );
    expect(outcomes.sort()).toEqual(['Ahit', 'Chit']);
    expect(errors).toEqual(['B死页']);
  });
});

describe('backfillPooled（候补回填步调：池并发 + 每任务错峰）', () => {
  it('7 行池 4：峰值并发 ≤4，每任务先睡 stagger（7 次计数）', async () => {
    let inflight = 0;
    let peak = 0;
    const staggers: number[] = [];
    const rows = Array.from({ length: 7 }, (_, i) => c({ code: 'A' + i }));
    await backfillPooled(
      rows,
      {
        pauseGate: () => false,
        probe: async () => {
          inflight++;
          peak = Math.max(peak, inflight);
          await Promise.resolve();
          inflight--;
          return [c({ code: 'X' })];
        },
        applyHit: () => {},
      },
      {
        concurrency: 4,
        staggerMs: 30,
        sleepFn: async ms => {
          staggers.push(ms);
        },
        onError: () => {},
      },
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(staggers).toHaveLength(7);
    expect(staggers.every(ms => ms === 30)).toBe(true);
  });
});
