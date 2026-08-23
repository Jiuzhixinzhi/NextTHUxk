// ═══════════════════════════════════════════════════════════════
// NextTHUxk — Config: namespace, constants, helpers, storage, network
// ═══════════════════════════════════════════════════════════════

var NX = window.NX = {};

NX.browser = typeof browser !== 'undefined' ? browser : chrome;

// ─── Constants ────────────────────────────────────────────────
NX.TAG = '[NextTHUxk]';
NX.SP = 'nextthuxk_';
NX.DATA_VER = 5;
NX.CUR_VER = '1.3.5';
NX.DANGEROUS_VERS = ['1.0.1','1.0.2','1.0.3','1.1.2','1.2.0'];
NX.ZY_LIMITS = {
  bx: [[1,1],[2,2],[3,Infinity]], // 必修：1志愿1门, 2志愿2门, 3志愿无限
  xx: [[1,1],[2,2],[3,Infinity]],
  rx: [[1,1],[2,2],[3,Infinity]],
  ty: [[1,1],[2,1],[3,Infinity]], // 体育：1志愿1门, 2志愿1门
};

// ─── Shared State ─────────────────────────────────────────────
NX.state = {
  SEM: '',
  GRADE: 0,
  BASE: '',
  isZhjwxk: false,
  isZhjw: false,
  allCourses: [],
  planData: [],
  activeGroup: null,
  stageCart: [],
  savedDrafts: [],
  queueDataMap: {},
  isQueuePhase: false,
  candidateCourses: [],
  previewMode: 'selected',   // 'selected' | 'stage' | 'draft'
  previewDraftIdx: -1,
  expandedDraft: -1,
  host: null,
  shadow: null,
  $: null,
  updateTimer: null,
};

// ─── Helpers ──────────────────────────────────────────────────
NX.esc = function (s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

// ─── Storage ──────────────────────────────────────────────────
NX.store = {
  get(k) {
    return new Promise(r =>
      NX.browser.storage.local.get(NX.SP + k, d => r(d[NX.SP + k]))
    );
  },
  set(k, v) {
    return new Promise(r =>
      NX.browser.storage.local.set({ [NX.SP + k]: v }, r)
    );
  },
};

// ─── Network ──────────────────────────────────────────────────
NX._GBK_URL_RE = /zhjw|xkBks|jhBks|vjsKcbBs/;

NX.fetchPage = async function (url, opts = {}) {
  const resp = await fetch(url, { credentials: 'include', ...opts });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  // URL 命中已知 GBK 接口 → 直接 GBK 解码，跳过无谓的 UTF-8 试解码
  if (NX._GBK_URL_RE.test(url)) return new TextDecoder('gbk').decode(buf);
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  const rawStr = new TextDecoder().decode(buf);
  const hasGbkCt = ct.includes('gb');
  const hasGbkMeta =
    rawStr.includes('charset=GBK') ||
    rawStr.includes('charset=gb2312') ||
    rawStr.includes('charset="GBK"');
  if (hasGbkCt || hasGbkMeta) {
    return new TextDecoder('gbk').decode(buf);
  }
  return rawStr;
};

// ─── 并发分页抓取器 ───────────────────────────────────────────
// 通用：先抓首页，再以固定并发窗口抓 page=1..maxPages，任一页为空/失败即停止
// 发起新页（分页数据单调，安全终止）。结果按页号排序，可选去重。
// 相比逐页串行（原实现最多 302 页 × 每页一个 RTT），总耗时 ≈ 总页数/并发度。
NX.pagedFetch = async function (opts) {
  const {
    fetchFirst,          // async () => html（首页，无 page 参数）；与 firstHtml 二选一
    firstHtml = null,    // 已抓好的首页 HTML（避免重复请求）
    fetchPage,           // async (p) => html（p >= 0；p=0 可能与首页重复，dedupe 吸收）
    parse,               // html => { items: [], hasData: bool }
    maxPages = 300,
    concurrency = 5,
    dedupe = null,       // item => key（可选，用于去重）
  } = opts;
  const pages = new Map();          // pageNum -> items
  const seen = dedupe ? new Set() : null;
  let stop = false;

  let fh = firstHtml;
  if (fh == null) {
    try { fh = await fetchFirst(); }
    catch (e) { console.warn(NX.TAG, 'pagedFetch first page:', e); return []; }
  }
  const first = parse(fh);
  const firstItems = [];
  for (const it of first.items) {
    if (seen) { const k = dedupe(it); if (seen.has(k)) continue; seen.add(k); }
    firstItems.push(it);
  }
  pages.set(0, firstItems);
  if (!first.hasData) return firstItems;

  let next = 0, active = 0;   // 从 0 起：兼容服务端 0 基分页（page=0 与首页重复时由 dedupe 吸收）
  await new Promise(resolve => {
    const launch = () => {
      while (!stop && active < concurrency && next <= maxPages) {
        const p = next++;
        active++;
        fetchPage(p)
          .then(html => {
            const r = parse(html);
            if (!r.hasData) { stop = true; return; }
            const items = [];
            for (const it of r.items) {
              if (seen) { const k = dedupe(it); if (seen.has(k)) continue; seen.add(k); }
              items.push(it);
            }
            pages.set(p, items);
          })
          .catch(() => { stop = true; })
          .finally(() => {
            active--;
            if (active === 0 && (stop || next > maxPages)) resolve();
            else launch();
          });
      }
      if (active === 0) resolve();
    };
    launch();
  });

  const out = [];
  [...pages.keys()].sort((a, b) => a - b).forEach(p => out.push(...pages.get(p)));
  return out;
};

// ─── Misc Helpers ─────────────────────────────────────────────
// 固定并发度跑完一批异步任务（无终止语义，与 pagedFetch 的空页终止互补）
NX.runPool = async function (items, concurrency, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
};

NX.debounce = function (fn, ms) {
  let t = 0;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
};

// 小写化缓存（key 为字符串故用 Map；全校课名种类有限，无泄漏风险）
NX._lowerCache = new Map();
NX.lc = function (s) {
  if (!s) return '';
  let v = NX._lowerCache.get(s);
  if (v === undefined) { v = s.toLowerCase(); NX._lowerCache.set(s, v); }
  return v;
};
