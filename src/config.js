// ═══════════════════════════════════════════════════════════════
// NextTHUxk — Config: namespace, constants, helpers, storage, network
// ═══════════════════════════════════════════════════════════════

var NX = window.NX = {};

NX.browser = typeof browser !== 'undefined' ? browser : chrome;

// ─── Constants ────────────────────────────────────────────────
NX.TAG = '[NextTHUxk]';
NX.SP = 'nextthuxk_';
NX.DATA_VER = 5;
NX.CUR_VER = '1.3.1';
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
NX.fetchPage = async function (url, opts = {}) {
  const resp = await fetch(url, { credentials: 'include', ...opts });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
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
  if (
    url.includes('zhjw') ||
    url.includes('xkBks') ||
    url.includes('jhBks') ||
    url.includes('vjsKcbBs')
  ) {
    return new TextDecoder('gbk').decode(buf);
  }
  return rawStr;
};
