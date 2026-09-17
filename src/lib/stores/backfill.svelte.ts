// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 元数据回填（IO 接线：已选时间/学分 + 候补元数据）
// B3 收拢：引擎纯核在 domain/backfill（可注入测试）；本模块持有预算/扫描
// 缓存与前台闸门（bus）。不 import session——池行与并入接缝由调用方注入，
// 避免 session ↔ backfill 循环（refreshSelected 在 session 侧调用候补回填）。
// ═══════════════════════════════════════════════════════════════
import type { Course, Ctx } from '../domain/types';
import { TAG } from '../core/constants';
import { keyOf, sleep } from '../core/utils';
import { serverSearch } from '../api/search';
import { hasParsedTime } from '../domain/pool';
import { backfillBatched, backfillPooled } from '../domain/backfill';
import { fgBusy, waitForegroundIdle } from './bus.svelte.ts';

// ─── 候补课元数据回填（原 api/records.backfillCandidateMeta，B3 上移）────

/** 按课号单查一页补齐学分/容量/时间。步调原样：runPool 4 并发 + 每任务 30ms 错峰。
 *  shouldPause 由调用方注入（检查点同步传前台占用判定）——前台查询在途时让路，
 *  避免后台 kkxxSearch 污染服务端会话游标（上游 PR #46 同款）。 */
export async function backfillCandidateMeta(ctx: Ctx, candidates: Course[], shouldPause?: () => boolean): Promise<void> {
  const todo = (candidates || []).filter(c => c && c.code && !c.credits);
  if (!todo.length) return;
  await backfillPooled(
    todo,
    {
      pauseGate: () => shouldPause?.() || false,
      probe: async c => {
        const r = await serverSearch(ctx, { kch: c.code });
        return r.rows || [];
      },
      applyHit: (c, hit) => {
        c.credits = hit.credits || 0;
        c.capacity = hit.capacity || 0;
        c.remaining = hit.remaining || 0;
        c.available = !!hit.available;
        if (!c.teacher && hit.teacher) c.teacher = hit.teacher;
        if (!c.time && hit.time) c.time = hit.time;
        c.xkTextNote = hit.xkTextNote || '';
      },
    },
    {
      concurrency: 4,
      staggerMs: 30,
      sleepFn: sleep,
      onError: (c, e) => console.warn(TAG, 'cand meta', c.code, e),
    },
  );
  console.log(TAG, 'candidate metadata backfilled:', todo.length);
}

// ─── 已选元数据回填（外校课时间在说明列；学分列位漂移时按课号补齐）────

const _selTried = new Map<string, number>();
let _bfScanP: Promise<Course[]> | null = null;
let _bfScanAborted = false;
let _selBfLogged = false;

export interface SelBackfillDeps {
  ctx: () => Ctx;
  /** 已选非候补池行（时间/学分回填对象） */
  selRows: () => Course[];
  /** 命中行并入池（session.mergeRows 接缝注入） */
  mergeRow: (hit: Course) => void;
}

/** 浏览页全量扫描兜底（外校课号排序靠前）：共享单飞 promise；
 *  前台接手即中断，半份不缓存、下次回填重建。 */
async function scanBrowse(ctx: Ctx): Promise<Course[]> {
  if (!_bfScanP) {
    _bfScanAborted = false;
    _bfScanP = (async () => {
      const scanned: Course[] = [];
      for (let p = 1; p <= 10; p++) {
        // 前台接手浏览翻页 → 让路（服务端会话游标敏感）；下次回填再补
        if (fgBusy()) {
          _bfScanAborted = true;
          break;
        }
        try {
          const res3 = await serverSearch(ctx, { page: p });
          const rs = res3.rows || [];
          if (!rs.length) break;
          scanned.push(...rs);
        } catch {
          break;
        }
      }
      console.log(TAG, '回填浏览扫描: ' + scanned.length + ' 行（外校课号排序靠前）');
      return scanned;
    })();
  }
  const scanned = await _bfScanP;
  if (_bfScanAborted) {
    // 中断的半份扫描不缓存，下次回填可重建
    _bfScanP = null;
    _bfScanAborted = false;
  }
  return scanned;
}

/** 已选行时间/学分回填。步调原样：批 5 并发 + 批间 60ms；每键 2 次预算，
 *  前台占用跳过且不耗预算；课号查空 → 课名兜底 → 浏览扫描兜底。 */
export async function backfillSelTimes(deps: SelBackfillDeps): Promise<void> {
  const c0 = deps.ctx();
  if (!c0.isZhjwxk && !c0.isWebvpn) return;
  if (!(await waitForegroundIdle())) return;
  const tried = _selTried;
  const sel = deps.selRows();
  const needsTime = (r: Course): boolean => !hasParsedTime(r);
  const unparsed = sel.filter(needsTime);
  // 触发范围：时间解析不出 或 学分缺失（WL 已选表列位漂移致 credits=0，用户报形势与政策）
  const need = sel.filter(r => needsTime(r) || !r.credits).filter(r => (tried.get(keyOf(r.code, r.seq)) || 0) < 2);
  if (!need.length) {
    if (unparsed.length && !_selBfLogged) {
      _selBfLogged = true;
      console.log(TAG, '已选元数据回填: 无可查（' + unparsed.length + ' 门时间解析不出已用尽预算）');
    }
    return;
  }
  console.log(TAG, '已选元数据回填: 查 ' + need.map(r => keyOf(r.code, r.seq)).join(','));
  const outcome: string[] = [];
  await backfillBatched(
    need,
    {
      // 前台占用则不发起后台请求（服务端会话游标敏感，上游 PR #46）；不消耗 2 次预算
      pauseGate: fgBusy,
      consume: k => tried.set(k, (tried.get(k) || 0) + 1),
      probe: async r => {
        let rows = (await serverSearch(deps.ctx(), { kch: r.code })).rows || [];
        if (!rows.length && r.name && !fgBusy()) {
          const byName = await serverSearch(deps.ctx(), { kcm: r.name });
          rows = byName.rows || [];
        }
        if (!rows.length && !fgBusy()) {
          rows = (await scanBrowse(deps.ctx())).filter(c => c.code === r.code);
        }
        return rows;
      },
      applyHit: (r, hit) => deps.mergeRow(hit),
      // 严格同课号：课名/浏览扫描兜底会带回他课行，无同课号行即未命中（原 session 口径）
      strictSameCode: true,
    },
    {
      batch: 5,
      gapMs: 60,
      sleepFn: sleep,
      onOutcome: (r, res) => {
        if (res.kind === 'skip') outcome.push(r.code + '⊘前台占用跳过');
        else if (res.kind === 'hit') outcome.push(r.code + '✓');
        else outcome.push(r.code + '×(搜到' + res.rowsFound + '行无匹配)');
      },
      onError: (r, e) => outcome.push(r.code + '×(' + ((e as Error).message || String(e)) + ')'),
    },
  );
  console.log(TAG, '已选元数据回填结果:', outcome.join(' , ') || '无');
}

/** 重置回填预算/扫描缓存（课表「重试解析」按钮 + 换学期生命周期） */
export function resetBfBudget(): void {
  _selTried.clear();
  _bfScanP = null;
  _bfScanAborted = false;
  _selBfLogged = false;
}
