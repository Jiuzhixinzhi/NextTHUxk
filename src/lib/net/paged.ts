// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 并发分页抓取器（v1.3.6 语义忠实移植）
// ① 单页失败/空页重试 retry 次再判定；② expectPages 已知时缺页自动补抓；
// ③ EMPTY 页按真末页吸收；④ 网络错误空喜更空 → cooldown 冷却后单并发收尾。
// ═══════════════════════════════════════════════════════════════
import { TAG } from '../core/constants';
import { runPool, sleep } from '../core/utils';

export interface PagedResult<T> {
  items: T[];
  hasData: boolean;
}

export interface PagedOptions<T> {
  fetchFirst?: () => Promise<string>;
  firstHtml?: string | null;
  fetchPage: (p: number) => Promise<string>;
  parse: (html: string) => PagedResult<T>;
  maxPages?: number;
  concurrency?: number;
  dedupe?: (item: T) => string;
  retry?: number;
  retryDelay?: number;
  expectPages?: number;
  label?: string;
  throttle?: number;
  cooldown?: number;
}

export async function pagedFetch<T>(opts: PagedOptions<T>): Promise<T[]> {
  const {
    fetchFirst,
    firstHtml = null,
    fetchPage,
    parse,
    maxPages = 300,
    concurrency = 5,
    dedupe = null,
    retry = 2,
    retryDelay = 300,
    expectPages = 0,
    label = '',
    throttle = 100,
    cooldown = 8000,
  } = opts;
  const pages = new Map<number, T[]>();
  const seen = dedupe ? new Set<string>() : null;

  // 节流闸：预约式占用槽位，保证任意两次实际请求发起间隔 ≥ throttle
  let lastReq = 0;
  const gate = () =>
    new Promise<void>(r => {
      const at = Math.max(Date.now(), lastReq + throttle);
      lastReq = at;
      setTimeout(r, Math.max(0, at - Date.now()));
    });

  const absorb = (p: number, items: T[]) => {
    const kept = pages.get(p) || [];
    for (const it of items) {
      if (seen && dedupe) {
        const k = dedupe(it);
        if (seen.has(k)) continue;
        seen.add(k);
      }
      kept.push(it);
    }
    pages.set(p, kept);
  };

  let pause = false;
  let emptyDiag: string | null = null;
  const diagEmpty = (html: string) => {
    if (emptyDiag) return;
    const h = html || '';
    const feats: string[] = [];
    if (h.includes('accessDenied')) feats.push('accessDenied(被拒绝)');
    if (/重新登录|登录超时|请先登录/.test(h)) feats.push('登录失效');
    if (h.includes('gridData')) feats.push('gridData(数组存在)');
    if (/<table/i.test(h)) feats.push('有表格结构');
    emptyDiag =
      'len=' + h.length + (feats.length ? ' 特征=[' + feats.join(', ') + ']' : ' 无已知特征') +
      ' head="' + h.slice(0, 100).replace(/\s+/g, ' ') + '"';
  };

  const fetchOne = async (p: number): Promise<PagedResult<T> | 'ERR' | 'EMPTY'> => {
    for (let attempt = 0; ; attempt++) {
      let r: PagedResult<T>;
      let html = '';
      try {
        if (throttle > 0) await gate();
        html = await fetchPage(p);
        r = parse(html);
      } catch (e) {
        pause = true;
        if (attempt < retry) {
          await sleep(retryDelay * (attempt + 1));
          continue;
        }
        pause = false;
        return 'ERR';
      }
      if (r.hasData) {
        pause = false;
        return r;
      }
      diagEmpty(html);
      pause = true;
      if (attempt < retry) {
        await sleep(retryDelay * (attempt + 1));
        continue;
      }
      pause = false;
      return 'EMPTY';
    }
  };

  let fh = firstHtml;
  if (fh == null) {
    if (!fetchFirst) throw new Error('pagedFetch: fetchFirst or firstHtml required');
    try {
      fh = await fetchFirst();
    } catch (e) {
      console.warn(TAG, 'pagedFetch first page:', e);
      return [];
    }
  }
  const first = parse(fh);
  absorb(0, first.items);
  if (!first.hasData) return [...(pages.get(0) || [])];

  const cap = expectPages > 0 ? Math.min(expectPages, maxPages) : maxPages;

  let next = 0,
    active = 0;
  let failed = false;
  await new Promise<void>(resolve => {
    const launch = () => {
      while (!failed && !pause && active < concurrency && next <= cap) {
        const p = next++;
        active++;
        fetchOne(p)
          .then(r => {
            if (typeof r === 'string') {
              failed = true;
              return;
            }
            absorb(p, r.items);
          })
          .finally(() => {
            active--;
            if (active === 0 && (failed || pause)) resolve();
            else launch();
          });
      }
      if (active === 0 && !pause) resolve();
    };
    launch();
  });

  // ── 总数校验补抓 ──
  if (expectPages > 0) {
    let missing: number[] = [];
    for (let p = 0; p <= cap; p++) {
      if (!pages.has(p)) missing.push(p);
    }
    if (missing.length) {
      console.warn(TAG, label, 'first pass missing', missing.length, 'pages, retrying:', missing.slice(0, 10).join(','), missing.length > 10 ? '…' : '');
      const recover = async (list: number[], conc: number) => {
        let errStreak = 0,
          empties = 0,
          errs = 0;
        await runPool(list, conc, async p => {
          if (errStreak >= 5) return;
          const r = await fetchOne(p);
          if (typeof r === 'string') {
            errStreak++;
            if (r === 'EMPTY') empties++;
            else errs++;
            console.warn(TAG, label, 'page', p, 'failed:', r);
            if (r === 'EMPTY') absorb(p, []);
            return;
          }
          errStreak = 0;
          absorb(p, r.items);
        });
        return { empties, errs };
      };
      const r1 = await recover(missing, 2);
      let still = missing.filter(p => !pages.has(p));
      if (still.length && cooldown > 0 && (r1.errs > 0 || r1.empties === 0)) {
        console.warn(TAG, label, still.length, 'pages still missing, cooling down', cooldown, 'ms before final round…');
        await sleep(cooldown);
        await recover(still, 1);
        still = still.filter(p => !pages.has(p));
      }
      if (still.length) {
        console.warn(TAG, label, 'STILL MISSING after recovery:', still.length, 'pages →', still.slice(0, 20).join(','));
        if (emptyDiag) console.warn(TAG, label, 'empty-page diagnostic:', emptyDiag);
      } else if (r1.empties > 0 && emptyDiag) {
        console.warn(TAG, label, 'empty pages absorbed as terminal:', r1.empties, '- diagnostic:', emptyDiag);
      }
    }
  }

  const out: T[] = [];
  [...pages.keys()]
    .sort((a, b) => a - b)
    .forEach(p => out.push(...(pages.get(p) || [])));
  return out;
}
