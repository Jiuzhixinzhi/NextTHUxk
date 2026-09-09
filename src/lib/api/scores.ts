// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 教务评教分数（校评）缓存层（服务端 IO）
// 端点：xkBks.xgpg_xspjyxkt.do?cm=xgpg_qbkcmycdzbData（单请求全量，无分页，
// 天然符合风暴护栏）。行粒度=课号×授课教师（同课不同师分数不同），检索键
// scoreKey(kch, 教师)。设计原则：评教为学期静止数据（选课阶段=上一学期评教）
// → 每学期拉一次，缓存命中不发请求；单飞行 promise；fail-soft 不影响选课主流程。
// ═══════════════════════════════════════════════════════════════
import type { Ctx, Course } from '../domain/types';
import { SCORE_VER, scoreKey, slimScores, type SemScoreCache } from '../domain/scores';
import { TAG } from '../core/constants';
import { fetchPage } from '../net/http';
import { K, store } from '../storage/store';

const EP = '/xkBks.xgpg_xspjyxkt.do?cm=xgpg_qbkcmycdzbData&p_xnxq=';
const EP_TAIL = '&p_xslb=bks';

const S = {
  ready: false,
  sem: '',
  loading: null as Promise<boolean> | null,
  map: {} as SemScoreCache['map'],
  byCode: {} as Record<string, string[]>, // kch → 该课号下的评教键（单师课兜底用）
};

function hydrate(c: SemScoreCache): void {
  S.map = c.map;
  const byCode: Record<string, string[]> = {};
  for (const k in c.map) {
    const kch = k.split('\u0001')[0]!;
    (byCode[kch] ||= []).push(k);
  }
  S.byCode = byCode;
  S.sem = c.sem;
  S.ready = true;
}

/** 单飞行：当前学期缓存命中 → 秒用不发请求；否则拉一次全量并持久化（失败不缓存，下次启动重试） */
export function ensureScores(ctx: Ctx): Promise<boolean> {
  if (!ctx || !ctx.isZhjwxk || !ctx.SEM) return Promise.resolve(false);
  if (S.ready && S.sem === ctx.SEM) return Promise.resolve(true);
  if (S.loading) return S.loading;
  S.loading = (async () => {
    try {
      const got = await store.get<SemScoreCache>(K.semScore);
      if (got && got.v === SCORE_VER && got.sem === ctx.SEM && got.map) {
        hydrate(got);
        console.log(TAG + '[Score]', '校评缓存命中', got.sem, Object.keys(got.map).length + ' 门');
        return true;
      }
    } catch {
      /* storage 异常不阻断 */
    }
    try {
      const text = await fetchPage(ctx.BASE + EP + encodeURIComponent(ctx.SEM) + EP_TAIL);
      const cache = slimScores(JSON.parse(text), ctx.SEM);
      hydrate(cache);
      console.log(TAG + '[Score]', '校评全量拉取', ctx.SEM, Object.keys(cache.map).length + ' 门');
      try {
        await store.set(K.semScore, cache);
      } catch (e) {
        console.warn(TAG + '[Score]', 'cache save fail:', e);
      }
      return true;
    } catch (e) {
      console.warn(TAG + '[Score]', 'fetch fail:', e instanceof Error ? e.message : e);
      return false;
    } finally {
      S.loading = null;
    }
  })();
  return S.loading;
}

/** 批量挂载：课号×教师精确关联；该课号仅一条评教时（单师课）教师串格式漂移也兜底命中 */
export function attachScores(list: Course[]): { matched: number; total: number } {
  const total = Array.isArray(list) ? list.length : 0;
  if (!S.ready || !total) return { matched: 0, total };
  let matched = 0;
  for (const c of list) {
    try {
      const code = String(c.code || '');
      let e = S.map[scoreKey(code, c.teacher || '')];
      if (!e) {
        const keys = S.byCode[code];
        if (keys && keys.length === 1) e = S.map[keys[0]!];
      }
      if (e) {
        c._scoreRef = { avg: e.a, count: e.n };
        matched++;
      } else if (c._scoreRef) {
        delete c._scoreRef;
      }
    } catch {
      /* 单课失败不影响其余 */
    }
  }
  return { matched, total };
}
