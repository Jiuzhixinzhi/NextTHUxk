// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 元数据回填引擎（纯核：前台让路 · 预算 · 三段匹配）
// B3 收拢两份复制粘贴的回填习语（session.backfillSelTimes 的 batch5+sleep60
// 与 records.backfillCandidateMeta 的 runPool4+sleep30）：IO 全部注入，
// 本模块不 import svelte、不碰 DOM、不发请求。
// ═══════════════════════════════════════════════════════════════
import type { Course } from './types';
import { keyOf, runPool, sleep } from '../core/utils';
import { matchPoolRow } from './match';

export type BackfillOutcome = { kind: 'skip' } | { kind: 'hit' } | { kind: 'miss'; rowsFound: number };

export interface BackfillTask {
  /** 前台占用判定：真则本行跳过且不消耗预算（服务端 kkxxSearch 会话游标敏感，上游 PR #46） */
  pauseGate: () => boolean;
  /** 预算计数：即将发起请求时调用（跳过不调） */
  consume?: (key: string) => void;
  /** 行探查：按课号（可含课名/扫描兜底）返回候选行 */
  probe: (r: Course) => Promise<Course[]>;
  /** 命中应用（并入池 / 字段回填） */
  applyHit: (r: Course, hit: Course) => void;
  /** 严格同课号匹配（已选回填口径：课名/扫描兜底会带回他课行，无同课号行即未命中）。
   *  缺省 false = 候补回填口径（同课号为空时回退全行三段匹配——kch 定向查询的行本就同课）。 */
  strictSameCode?: boolean;
}

/** 单行回填：让路检查（不耗预算）→ 探查 → 三段匹配挑对班（归一课序 →
 *  同课同师 → 首行；同课号多班直接取首行会借错时间）→ 应用。 */
export async function runBackfillRow(r: Course, t: BackfillTask): Promise<BackfillOutcome> {
  if (t.pauseGate()) return { kind: 'skip' };
  t.consume?.(keyOf(r.code, r.seq));
  const rows = await t.probe(r);
  // 前台中途接手（原 session 口径）：探到 0 行且此刻前台占用 → 判「跳过」而非「未命中」，
  // 交下次回填再补（预算已消耗，口径不变；仅结果标签区分）。
  if (!rows.length && t.pauseGate()) return { kind: 'skip' };
  const same = rows.filter(x => String(x.code) === String(r.code));
  const scope = t.strictSameCode ? same : same.length ? same : rows;
  const hit = matchPoolRow(scope, r.seq, r.teacher);
  if (hit) {
    t.applyHit(r, hit);
    return { kind: 'hit' };
  }
  return { kind: 'miss', rowsFound: rows.length };
}

export type SleepFn = (ms: number) => Promise<void>;

/** 批式驱动（原 backfillSelTimes 步调）：batch 行并发一批、批间隔 gapMs。 */
export async function backfillBatched(
  rows: Course[],
  t: BackfillTask,
  o: { batch: number; gapMs: number; sleepFn?: SleepFn; onOutcome?: (r: Course, res: BackfillOutcome) => void; onError?: (r: Course, e: unknown) => void },
): Promise<void> {
  const zzz = o.sleepFn || sleep;
  for (let i = 0; i < rows.length; i += o.batch) {
    await Promise.all(
      rows.slice(i, i + o.batch).map(async r => {
        try {
          const res = await runBackfillRow(r, t);
          o.onOutcome?.(r, res);
        } catch (e) {
          o.onError?.(r, e);
        }
      }),
    );
    if (i + o.batch < rows.length) await zzz(o.gapMs);
  }
}

/** 池式驱动（原 backfillCandidateMeta 步调）：concurrency 并发滚动、每任务先 staggerMs 错峰。 */
export async function backfillPooled(
  rows: Course[],
  t: BackfillTask,
  o: { concurrency: number; staggerMs: number; sleepFn?: SleepFn; onError?: (r: Course, e: unknown) => void },
): Promise<void> {
  const zzz = o.sleepFn || sleep;
  await runPool(rows, o.concurrency, async r => {
    await zzz(o.staggerMs);
    try {
      await runBackfillRow(r, t);
    } catch (e) {
      o.onError?.(r, e);
    }
  });
}
