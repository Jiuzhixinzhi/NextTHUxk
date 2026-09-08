// ═══════════════════════════════════════════════════════════════
// NextTHUxk — THU选课社区 (thubook.help/thucourse) 实时评价层
// 数据/内容由 THU选课社区贡献者提供，授权协议 CC BY-NC 4.0：
//   https://creativecommons.org/licenses/by-nc/4.0/deed.zh
// 设计原则：实时拉取不本地囤正文 · 只缓存精简索引（SWR）+ 单飞行 promise ·
// fail-soft：任一环节失败都不影响选课主流程。
// ═══════════════════════════════════════════════════════════════
import type { Course, TbEntry } from '../domain/types';
import { TAG } from '../core/constants';
import { K, store } from '../storage/store';

const TB_PAGE = 'https://thubook.help/thucourse/';
const TB_DATA = 'https://thubook.help/data/';
const IDX_VER = 1;
const IDX_TTL = 24 * 3600 * 1000;
const DETAIL_TTL = 10 * 60 * 1000;

function normName(s: string): string {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\s\u00a0\u3000]+/g, '')
    .toLowerCase();
}

function normTeacherTokens(s: string): string[] {
  return String(s || '')
    .normalize('NFKC')
    .split(/[,，、;；/\s]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

const tKey = (tokens: string[]) => tokens.slice().sort().join('\u0002');

interface S {
  ready: boolean;
  loadingPromise: Promise<boolean> | null;
  entries: TbEntry[];
  bySqid: Map<string, TbEntry>;
  byNameT: Map<string, TbEntry[]>;
  byName: Map<string, TbEntry[]>;
  detailCache: Map<string, { ts: number; data: { count: number; results: unknown[] } }>;
  stats: Record<string, number> | null;
}

const S: S = {
  ready: false,
  loadingPromise: null,
  entries: [],
  bySqid: new Map(),
  byNameT: new Map(),
  byName: new Map(),
  detailCache: new Map(),
  stats: null,
};

let onIndexChange: (() => void) | null = null;
export function setOnIndexChange(fn: (() => void) | null) {
  onIndexChange = fn;
}

export function tbStats(): Record<string, number> | null {
  return S.stats;
}

function slimIndex(raw: { courses?: Record<string, unknown> }): { v: number; ts: number; courses: Record<string, TbEntry> } {
  const src = (raw && raw.courses) || {};
  const out: Record<string, TbEntry> = {};
  for (const k in src) {
    const e = src[k] as Record<string, unknown>;
    if (!e || typeof e !== 'object' || e.sqid == null) continue;
    out[String(e.sqid)] = {
      kcm: (e.kcm as string) || '',
      jsm: (e.jsm as string) || '',
      kkdw: String(e.kkdw || '').trim(),
      sqid: String(e.sqid),
      tid: e.tid != null ? (e.tid as number) : null,
      count: (e.count as number) || 0,
      avg: Math.round(((e.avg as number) || 0) * 10) / 10,
    };
  }
  return { v: IDX_VER, ts: Date.now(), courses: out };
}

function push(map: Map<string, TbEntry[]>, k: string, v: TbEntry) {
  let a = map.get(k);
  if (!a) {
    a = [];
    map.set(k, a);
  }
  a.push(v);
}

function buildMaps(idx: { courses: Record<string, TbEntry> }) {
  const entries: TbEntry[] = [];
  const bySqid = new Map<string, TbEntry>();
  const byNameT = new Map<string, TbEntry[]>();
  const byName = new Map<string, TbEntry[]>();
  for (const sqid in idx.courses) {
    const e = idx.courses[sqid]!;
    e.nt = normTeacherTokens(e.jsm);
    entries.push(e);
    bySqid.set(String(sqid), e);
    const nk = normName(e.kcm);
    push(byNameT, nk + '\u0001' + tKey(e.nt), e);
    push(byName, nk, e);
  }
  S.entries = entries;
  S.bySqid = bySqid;
  S.byNameT = byNameT;
  S.byName = byName;
  S.ready = true;
}

async function fetchIndex(): Promise<{ v: number; ts: number; courses: Record<string, TbEntry> }> {
  const res = await fetch(TB_DATA + 'with_comment_index.json', { credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return slimIndex(await res.json());
}

/** SWR：先秒用缓存建图；超 TTL 后台静默刷新（单飞行） */
export function ensureIndex(): Promise<boolean> {
  if (S.loadingPromise) return S.loadingPromise;
  S.loadingPromise = (async () => {
    let cached: { v: number; ts: number; courses: Record<string, TbEntry> } | null = null;
    let cachedTs = 0;
    try {
      const got = await store.get<{ v: number; ts: number; courses: Record<string, TbEntry> }>(K.tbookIdx);
      if (got) cached = got;
      cachedTs = (await store.get<number>(K.tbookIdxTs)) || 0;
    } catch {
      /* storage 异常不阻断 */
    }
    if (cached && cached.v === IDX_VER && cached.courses) {
      try {
        buildMaps(cached);
      } catch (e) {
        console.warn(TAG + '[TB]', 'cache build fail', e);
      }
    }
    const fresh = !!(cached && Date.now() - cachedTs < IDX_TTL);
    if (!fresh) {
      try {
        const idx = await fetchIndex();
        buildMaps(idx);
        reattachIt();
        try {
          await store.set(K.tbookIdx, idx);
          await store.set(K.tbookIdxTs, Date.now());
        } catch (e) {
          console.warn(TAG + '[TB]', 'idx save fail', e);
        }
      } catch (e) {
        console.warn(TAG + '[TB]', 'index fetch fail', e instanceof Error ? e.message : e);
      }
    } else {
      fetchIndex()
        .then(idx => {
          buildMaps(idx);
          reattachIt();
          try {
            store.set(K.tbookIdx, idx);
            store.set(K.tbookIdxTs, Date.now());
          } catch {
            /* noop */
          }
        })
        .catch(() => {});
    }
    return S.ready;
  })();
  return S.loadingPromise;
}

function reattachIt() {
  try {
    if (onIndexChange) onIndexChange();
  } catch {
    /* fail-soft */
  }
}

/** 匹配（三级降级）：T1 名+师全精确 → T2 同名桶教师相交 → T3 去尾缀漂移（强制教师核对） */
export function tbMatch(c: { name: string; teacher?: string }): TbEntry | null {
  if (!S.ready) return null;
  const nk = normName(c.name);
  const ct = normTeacherTokens(c.teacher || '');
  const ctk = tKey(ct);
  const hit = S.byNameT.get(nk + '\u0001' + ctk);
  if (hit && hit.length === 1) {
    bump('t1');
    return hit[0]!;
  }
  const bucket = S.byName.get(nk);
  if (bucket) {
    if (bucket.length === 1) {
      const e = bucket[0]!;
      const disjoint = ct.length && e.nt!.length && !ct.some(t => e.nt!.includes(t));
      if (!disjoint) {
        bump('t2');
        return e;
      }
    } else {
      let best: TbEntry | null = null;
      let bestScore = -1;
      for (const e of bucket) {
        const inter = ct.filter(t => e.nt!.includes(t)).length;
        let score: number;
        if (ct.length && e.nt!.length) score = inter > 0 ? 10 + inter : -1;
        else score = 5;
        if (score < 0) continue;
        score += Math.min(e.count, 10) * 0.01;
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      if (best) {
        bump('t2');
        return best;
      }
    }
  }
  const nkStripped = nk.replace(/\((?:英|中文)\)|（(?:英|中文)）|荣誉|\(\d+\)$/, '');
  if (nkStripped && nkStripped !== nk) {
    const b2 = S.byName.get(nkStripped);
    if (b2 && b2.length === 1) {
      const e0 = b2[0]!;
      const okTeacher = !ct.length || !e0.nt!.length || ct.some(t => e0.nt!.includes(t));
      if (okTeacher) {
        bump('t3');
        return e0;
      }
    }
  }
  bump('miss');
  return null;

  function bump(k: string) {
    if (!S.stats) S.stats = {};
    S.stats[k] = (S.stats[k] || 0) + 1;
  }
}

/** 批量挂载：给每门课附 _tbRef（评分徽章/排序源）。每次调用重置 stats。 */
export function tbAttach(list: Course[]): { matched: number; total: number } {
  if (!S.ready || !Array.isArray(list)) return { matched: 0, total: Array.isArray(list) ? list.length : 0 };
  let matched = 0;
  S.stats = {};
  for (const c of list) {
    try {
      const e = tbMatch(c);
      if (e) {
        c._tbRef = e;
        matched++;
      } else if (c._tbRef) {
        delete c._tbRef;
      }
    } catch {
      /* 单课失败不影响其余 */
    }
  }
  S.stats = S.stats || {};
  S.stats.total = list.length;
  S.stats.matched = matched;
  return { matched, total: list.length };
}

/** 点评正文（实时拉取 + 短缓存；翻页 ≤5 跳） */
export async function tbFetchReviews(sqid: string | number): Promise<{ count: number; results: unknown[] }> {
  const key = String(sqid);
  const hit = S.detailCache.get(key);
  if (hit && Date.now() - hit.ts < DETAIL_TTL) return hit.data;
  const res = await fetch(TB_DATA + 'courses/' + key + '.json', { credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const doc = (await res.json()) as { count?: number; results?: unknown[]; next?: string };
  let results = Array.from(doc.results || []);
  let next = doc.next;
  let hops = 0;
  while (next && hops < 5) {
    const p = await fetch(next, { credentials: 'omit' });
    if (!p.ok) break;
    const pd = (await p.json()) as { results?: unknown[]; next?: string };
    results = results.concat(Array.from(pd.results || []));
    next = pd.next;
    hops++;
  }
  results.sort((a, b) => String((b as { created_at?: string }).created_at || '').localeCompare(String((a as { created_at?: string }).created_at || '')));
  const data = { count: doc.count != null ? doc.count : results.length, results };
  S.detailCache.set(key, { ts: Date.now(), data });
  return data;
}

export function tbCourseUrl(e: TbEntry | null): string {
  if (!e) return TB_PAGE + 'search.html';
  return TB_PAGE + 'course.html?sqid=' + encodeURIComponent(e.sqid) + '&tid=' + encodeURIComponent(e.tid == null ? '' : String(e.tid)) + '&name=' + encodeURIComponent(e.kcm) + '&teacher=' + encodeURIComponent(e.jsm || '') + '&dept=' + encodeURIComponent(e.kkdw || '');
}

export function tbWriteUrl(e: TbEntry | null): string {
  if (!e) return TB_PAGE + 'new-review';
  return TB_PAGE + 'new-review?courseId=' + encodeURIComponent(e.sqid) + '&courseName=' + encodeURIComponent(e.kcm || '');
}

export function tbStars(avg: number | string): string {
  const full = Math.round(Number(avg) || 0);
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= full ? '★' : '☆';
  return s;
}

export function tbReady(): boolean {
  return S.ready;
}
