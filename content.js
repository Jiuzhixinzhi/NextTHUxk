// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 下一代选课 | 全屏双栏 AI 智能选课工作台
// ═══════════════════════════════════════════════════════════════
(function () {
'use strict';

// ─── §1. Entry Guard ──────────────────────────────────────
if (window.parent !== window) return;
if (!/zhjwxk|zhjw\.cic|webvpn/.test(location.hostname)) return;

const TAG = '[NextTHUxk]';
console.log(TAG, 'loading on', location.href);

// ─── §2. Config ───────────────────────────────────────────
const SP = 'nextthuxk_';
let SEM = (location.href.match(/p_xnxq=([^&]+)/) || [,''])[1];
let GRADE = 0; // 1=大一 2=大二 3=大三 4=大四
const BASE = location.origin;
const DATA_VER = 4; // bump when data structure changes
const isZhjwxk = location.hostname === 'zhjwxk.cic.tsinghua.edu.cn';
const isZhjw   = location.hostname === 'zhjw.cic.tsinghua.edu.cn';

// ─── §3. Helpers ──────────────────────────────────────────
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
let $; // will be shadow.getElementById

// ─── §4. Storage ──────────────────────────────────────────
const store = {
  get(k) { return new Promise(r => chrome.storage.local.get(SP+k, d => r(d[SP+k]))); },
  set(k, v) { return new Promise(r => chrome.storage.local.set({[SP+k]:v}, r)); },
};

// ─── §5. Network ──────────────────────────────────────────
async function fetchPage(url, opts = {}) {
  const resp = await fetch(url, { credentials: 'include', ...opts });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  // Always try GBK first for zhjw pages, fallback to UTF-8
  const ct = (resp.headers.get('content-type')||'').toLowerCase();
  const raw = new Uint8Array(buf);
  // Check for GBK indicators: content-type header or meta charset in raw bytes
  const hasGbkCt = ct.includes('gb');
  // Check raw bytes for "charset=GBK" (ASCII, same in any encoding)
  const rawStr = new TextDecoder().decode(buf);
  const hasGbkMeta = rawStr.includes('charset=GBK') || rawStr.includes('charset=gb2312') || rawStr.includes('charset="GBK"');
  if (hasGbkCt || hasGbkMeta) {
    return new TextDecoder('gbk').decode(buf);
  }
  // For zhjw domain responses without explicit charset, assume GBK
  if (url.includes('zhjw') || url.includes('xkBks') || url.includes('jhBks') || url.includes('vjsKcbBs')) {
    return new TextDecoder('gbk').decode(buf);
  }
  return rawStr;
}

// ─── §6. Data Layer ───────────────────────────────────────
async function fetchTrainingPlan() {
  if (isZhjwxk) {
    const html = await fetchPage(`${BASE}/jhBks.vjhBksPyfakcbBs.do?m=showBksZxZdxjxjhXmxqkclist&p_xnxq=${SEM}`);
    return parsePlan(new DOMParser().parseFromString(html, 'text/html'));
  }
  if (isZhjw) {
    const listHtml = await fetchPage(`${BASE}/jhBks.vjhBksPyfakcbBs.do?m=grPyfabks&theRole=bks&theModule=pyfa`);
    if (listHtml.includes('accessDenied')) return [];
    const m = /fajhh=(\d+)/.exec(listHtml);
    if (!m) return [];
    const html = await fetchPage(`${BASE}/jhBks.vjhBksPyfakcbBs.do?m=index2&theModule=pyfa&p_fajhh=${m[1]}`);
    return parseFullProgram(new DOMParser().parseFromString(html, 'text/html'));
  }
  return [];
}

function parsePlan(doc) {
  const rows = doc.querySelectorAll('table#kcTable tr');
  const out = [];
  let sem = '', season = '';
  for (const row of rows) {
    const tds = row.querySelectorAll('td');
    if (!tds.length) continue;
    const cells = [...tds].map(td => td.textContent.trim().replace(/\s+/g,' '));
    for (const td of tds) {
      const t = td.textContent.trim();
      const sm = t.match(/(\d{4}-\d{4}学年)/); if (sm) sem = sm[1];
      const sn = t.match(/^(秋|春|夏)$/);         if (sn) season = sn[1];
    }
    const code = cells.find(c => /^\d{8}$/.test(c));
    if (!code) continue;
    const name = cells.find(c => c.length>1 && !/^\d+$/.test(c) && !['必修','限选','任选','秋','春','夏'].includes(c) && !c.includes('学年'));
    const attr = cells.find(c => ['必修','限选','任选'].includes(c));
    const credit = cells.find(c => /^\d{1,2}(\.\d)?$/.test(c) && c !== code);
    const group = cells.find(c => c.length>2 && !['必修','限选','任选'].includes(c) && !/^\d/.test(c) && !c.includes('学年') && c!==name);
    if (name) out.push({ semester: sem+' '+season, code, name:name.replace(/\s+/g,''), attr:attr||'', credits:parseFloat(credit)||0, group:group||'' });
  }
  return out;
}

function parseFullProgram(doc) {
  const rows = doc.querySelectorAll('#content_1 table tbody tr.trr2');
  const out = [];
  let grp = '', attr = '';
  for (const row of rows) {
    const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
    if (cells.length >= 9) { grp = cells[0]; attr = cells[1]||attr; }
    const idx = cells.length >= 9 ? 2 : 0;
    const code = cells[idx], name = cells[idx+1];
    if (code && name && /^\d+$/.test(code))
      out.push({ code, name, credits: parseFloat(cells[idx+2])||0, attr, group:grp, semester:'' });
  }
  return out;
}

async function fetchCourseCatalog() {
  if (!isZhjwxk) return [];
  const all = [];
  // GET paginated results: page parameter controls pagination
  for (let p = -1; p <= 200; p++) {
    const url = p === -1
      ? `${BASE}/xkBks.vxkBksJxjhBs.do?m=kkxxSearch&p_xnxq=${SEM}`
      : `${BASE}/xkBks.vxkBksJxjhBs.do?m=kkxxSearch&p_xnxq=${SEM}&page=${p}`;
    try {
      const html = await fetchPage(url);
      const batch = parseCatalog(new DOMParser().parseFromString(html, 'text/html'));
      if (!batch.length && p >= 0) break;
      all.push(...batch);
      if (p > 0 && batch.length === 0) break;
    } catch(e) {
      console.warn(TAG, 'catalog page', p, e);
      break;
    }
  }
  console.log(TAG, 'catalog total:', all.length, 'courses');
  return all;
}

function parseCatalog(doc) {
  const out = [];
  doc.querySelectorAll('tr.trr2').forEach(row => {
    const tds = row.querySelectorAll('td');
    if (tds.length < 11) return;
    const cell = i => (tds[i]?.textContent || '').trim().replace(/\s+/g, ' ');
    const code = cell(1);
    const name = cell(3);
    if (!code || !name || !/^\d+$/.test(code)) return;
    const bksCap = parseInt(cell(6)) || 0;
    const bksRem = parseInt(cell(7)) || 0;
    // Extract teacher ID from the teacher link for course detail URL
    const teacherLink = tds[5]?.querySelector('a[href*="showJsDetail"]');
    const teacherHref = teacherLink?.getAttribute('href') || '';
    const teacherIdMatch = teacherHref.match(/p_jsh=([^&]+)/);
    const teacherId = teacherIdMatch ? teacherIdMatch[1] : '';
    // Extract course detail link from the course name link
    const courseLink = tds[3]?.querySelector('a[href*="showToXs"]');
    const detailHref = courseLink?.getAttribute('href') || '';
    out.push({
      code,
      seq: cell(2),
      name,
      credits: parseFloat(cell(4)) || 0,
      teacher: cell(5),
      teacherId,
      department: cell(0),
      time: cell(10),
      capacity: bksCap,
      remaining: bksRem,
      available: bksRem > 0,
      selected: false,
      queue: '',
      group: cell(0),
      attr: '',
      detailUrl: detailHref,
      // 志愿数据（后续由 fetchVolunteer 填充）
      volRequired: '', volElective: '', volOptional: '', volSports: '',
    });
  });
  return out;
}

// ─── §6b. Volunteer Data ─────────────────────────────────
function parseVolFromHtml(html) {
  // gridData: [code, seq, name, dept, capacity, applied, "必X,X,X", "限X,X,X", "任X,X,X"]
  const map = {};
  const regex = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*\]/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const code = m[1];
    const seq = m[2];
    // Key by code+seq so each section is independent
    const key = code + '_' + seq;
    map[key] = {
      code,
      seq,
      capacity: parseInt(m[3]) || 0,
      applied: parseInt(m[4]) || 0,
      volRequired: m[5],
      volElective: m[6],
      volOptional: m[7],
    };
  }
  return map;
}

function parseVolSportsFromHtml(html) {
  // Sports gridData: [code, seq, name, capacity, applied, "体育X,X,X"]
  const map = {};
  const regex = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*\]/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const code = m[1];
    const seq = m[2];
    const key = code + '_' + seq;
    map[key] = {
      code,
      seq,
      capacity: parseInt(m[3]) || 0,
      applied: parseInt(m[4]) || 0,
      volSports: m[5],
    };
  }
  return map;
}

async function fetchVolunteer() {
  if (!isZhjwxk) return {};
  try {
    // Regular volunteer: paginated (tbzySearchBR)
    const allMap = {};
    for (let p = -1; p <= 200; p++) {
      const url = p === -1
        ? `${BASE}/xkBks.xkBksZytjb.do?m=tbzySearchBR&p_xnxq=${SEM}`
        : `${BASE}/xkBks.xkBksZytjb.do?m=tbzySearchBR&p_xnxq=${SEM}&page=${p}`;
      const html = await fetchPage(url);
      const batch = parseVolFromHtml(html);
      if (!Object.keys(batch).length && p >= 0) break;
      Object.assign(allMap, batch);
      if (p > 0 && !Object.keys(batch).length) break;
    }
    console.log(TAG, 'volunteer data:', Object.keys(allMap).length, 'courses');

    // Sports volunteer: tbzySearchTy (体育课志愿，独立页面)
    try {
      const sportsMap = {};
      for (let p = -1; p <= 20; p++) {
        const url = p === -1
          ? `${BASE}/xkBks.xkBksZytjb.do?m=tbzySearchTy&p_xnxq=${SEM}`
          : `${BASE}/xkBks.xkBksZytjb.do?m=tbzySearchTy&p_xnxq=${SEM}&page=${p}`;
        const html = await fetchPage(url);
        const batch = parseVolSportsFromHtml(html);
        if (!Object.keys(batch).length && p >= 0) break;
        Object.assign(sportsMap, batch);
        if (p > 0 && !Object.keys(batch).length) break;
      }
      // Merge sports data into allMap
      for (const [key, val] of Object.entries(sportsMap)) {
        if (allMap[key]) {
          Object.assign(allMap[key], val);
        } else {
          allMap[key] = val;
        }
      }
      console.log(TAG, 'sports volunteer data:', Object.keys(sportsMap).length, 'courses');
    } catch(e) { console.warn(TAG, 'sports volunteer fetch:', e); }
    return allMap;
  } catch(e) { console.warn(TAG, 'volunteer fetch:', e); return {}; }
}

// ─── §6c. Course Selection/Drop API ─────────────────────
// Load the real search page in iframe, extract token from its form,
// then create+submit a form IN THAT SAME iframe so session context matches.

function courseFlag(course) {
  const a = (course.attr || '').trim();
  if (a === '限选') return 'xx';
  if (a === '任选') return 'rx';
  if (a === '体育') return 'ty';
  if (a === '必修') return 'bx';
  // Not in plan: default to rx (任选)
  return 'rx';
}

function isSportsCourse(course) {
  return (course.attr||'') === '体育'
    || (course.department||'').includes('体育')
    || (course.name||'').includes('体育')
    || course.typeLabel === '体育';
}

// Base flag determines allowed type options
// 体育→体育, 必修→必修/限选/任选, 限选→限选/任选, 任选→任选
function baseFlag(course) {
  if (isSportsCourse(course)) return 'ty';
  return courseFlag(course);
}

function allowedFlags(bf) {
  if (bf === 'ty') return ['ty'];
  if (bf === 'bx') return ['bx','xx','rx'];
  if (bf === 'xx') return ['xx','rx'];
  return ['rx'];
}

function iframeFormSubmit(searchUrl, postFields) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:0;height:0;border:none;position:absolute;left:-9999px';
    document.documentElement.appendChild(iframe);

    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; iframe.remove(); resolve(result); } };

    // Phase 1: load search page → extract token
    iframe.onload = () => {
      try {
        iframe.contentWindow.alert = () => {};
        const doc = iframe.contentDocument;
        const token = doc.querySelector('input[name="token"]')?.value;
        if (!token) { finish({ ok: false, msg: '无法获取 token' }); return; }

        // Phase 2: build a form in the iframe's document and submit it
        const form = doc.createElement('form');
        form.method = 'POST';
        form.action = `${BASE}/xkBks.vxkBksXkbBs.do`;
        postFields.token = token;
        for (const [k, v] of Object.entries(postFields)) {
          const inp = doc.createElement('input');
          inp.type = 'hidden'; inp.name = k; inp.value = v;
          form.appendChild(inp);
        }
        doc.body.appendChild(form);

        // Phase 3: handle the submission response
        iframe.onload = () => {
          try { iframe.contentWindow.alert = () => {}; } catch(e) {}
          // Don't try to parse response — just signal completion
          setTimeout(() => finish({ ok: true, submitted: true }), 500);
        };

        form.submit();
      } catch(e) {
        finish({ ok: false, msg: e.message });
      }
    };

    iframe.src = searchUrl;
    setTimeout(() => finish({ ok: false, msg: '加载超时' }), 30000);
  });
}

async function submitCourse(code, seq, zy = 3, flag = 'bx') {
  const mSearch = { bx:'bxSearch', xx:'xxSearch', rx:'rxSearch', ty:'tySearch' }[flag] || 'bxSearch';
  const mVal = { bx:'saveBxKc', xx:'saveXxKc', rx:'saveRxKc', ty:'saveTyKc' }[flag] || 'saveBxKc';
  const extra = flag === 'rx' ? '&is_zyrxk=1' : '';
  const searchUrl = `${BASE}/xkBks.vxkBksXkbBs.do?m=${mSearch}&p_xnxq=${SEM}&tokenPriFlag=${flag}${extra}`;

  // Each type uses different field names for checkbox and volunteer select
  const idName = { bx:'p_bxk_id', xx:'p_xxk_id', rx:'p_rx_id', ty:'p_rxTy_id' }[flag];
  const zyName = { bx:'p_bxk_xkzy', xx:'p_xxk_xkzy', rx:'p_rx_xkzy', ty:'p_rxTy_xkzy' }[flag];

  const fields = { m: mVal, p_xnxq: SEM, tokenPriFlag: flag, page: '' };
  fields[idName] = `${SEM};${code};${seq};`;
  fields[zyName] = String(zy);
  if (flag === 'rx') { fields.is_zyrxk = '1'; fields.p_rxklxm = ''; }
  if (flag === 'ty') { fields.rxTyType = ''; }

  const res = await iframeFormSubmit(searchUrl, fields);
  if (!res.submitted) return res;

  // Verify by re-fetching selected list
  await new Promise(r => setTimeout(r, 1500));
  const sel = await fetchSelectedCourses();
  const found = sel.some(s => s.code === code && String(s.seq) === String(seq));
  return found
    ? { ok: true, msg: '选课成功' }
    : { ok: false, msg: '选课未生效，请确认课程类型是否正确' };
}

async function dropCourse(code, seq) {
  const searchUrl = `${BASE}/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${SEM}&tokenPriFlag=yx`;
  const res = await iframeFormSubmit(searchUrl, {
    m: 'deleteYxk', p_xnxq: SEM, page: '',
    tokenPriFlag: 'yx', tk: '', jhzy_kch: '', jhzy_kxh: '', jhzy_zy: '',
    'p_del_id': `${SEM};${code};${seq};`,
  });
  if (!res.submitted) return res;

  await new Promise(r => setTimeout(r, 1500));
  const sel = await fetchSelectedCourses();
  const still = sel.some(s => s.code === code && String(s.seq) === String(seq));
  return still
    ? { ok: false, msg: '退选未生效，请稍后重试' }
    : { ok: true, msg: '退选成功' };
}

async function changeVolunteer(code, seq, targetZy) {
  const searchUrl = `${BASE}/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${SEM}&tokenPriFlag=yx`;
  const res = await iframeFormSubmit(searchUrl, {
    m: 'changeZY', p_xnxq: SEM, tokenPriFlag: 'yx', page: '',
    tk: '', jhzy_kch: code, jhzy_kxh: seq, jhzy_zy: String(targetZy),
  });
  if (!res.submitted) return { ok: false, msg: '志愿调整提交失败' };
  await new Promise(r => setTimeout(r, 1000));
  return { ok: true, msg: `志愿已调整为第${targetZy}志愿` };
}

async function fetchSelectedCourses() {
  if (!isZhjwxk) return [];
  try {
    const _t = Date.now();
    const html = await fetchPage(`${BASE}/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${SEM}&tokenPriFlag=yx&_t=${_t}`);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Parse gridZy: ["code,seq", "zyNum", "typeCode(006/007/008)", "isSports(是/否)", "001"]
    const zyMap = {};
    const zyRe = /\[\s*"(\d+),(\d+)"\s*,\s*"(\d+)"\s*,\s*"(\d+)"\s*,\s*"([^"]*)"\s*,\s*"[^"]*"\s*\]/g;
    let zm;
    while ((zm = zyRe.exec(html)) !== null) {
      const [_, code, seq, zy, typeCode, isSports] = zm;
      const typeLabel = isSports === '是' ? '体育' : ({ '006': '必修', '008': '限选', '007': '任选' }[typeCode] || '');
      zyMap[code + '_' + seq] = { zy: parseInt(zy), typeCode, typeLabel };
    }

    const rows = doc.querySelectorAll('tr.trr2');
    const selected = [];
    rows.forEach(row => {
      const radio = row.querySelector('input[name="p_del_id"]');
      const val = radio?.getAttribute('value') || '';
      const parts = val.split(';');
      const code = parts[1] || '';
      const seq = parts[2] || '';
      if (!code) return;
      const tds = row.querySelectorAll('td');
      const cell = i => (tds[i]?.textContent || '').trim().replace(/\s+/g, ' ');
      const zyInfo = zyMap[code + '_' + seq] || {};
      // 体育课不在gridZy里，需要从cell2解析志愿，从cell1空+课程名特征检测
      const cell2 = cell(2) || '';
      const zyFromCell = cell2.match(/第([一二三])志愿/);
      const isSportsCourse = !cell(1) && zyFromCell;
      const zyNum = zyInfo.zy || (zyFromCell ? ({'一':1,'二':2,'三':3}[zyFromCell[1]]) : 0);
      const typeLabel = isSportsCourse ? '体育' : (cell(1) || zyInfo.typeLabel || '');
      selected.push({
        code, seq, name: cell(3) || cell(1), teacher: cell(7) || cell(2),
        time: cell(6) || cell(3), credits: parseFloat(cell(8) || cell(4)) || 0,
        typeLabel,
        zy: zyNum,
        typeCode: isSportsCourse ? 'ty' : (zyInfo.typeCode || ''),
      });
    });
    console.log(TAG, 'selected courses:', selected.length);
    return selected;
  } catch(e) { console.warn(TAG, 'fetch selected:', e); return []; }
}

async function fetchCourseDetail(teacherId, code) {
  if (!isZhjwxk) return null;
  const url = `${BASE}/js.vjsKcbBs.do?m=showToXs&p_id=${encodeURIComponent(teacherId+';'+code)}`;
  try {
    const html = await fetchPage(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // The page has nested tables: outer <table class="table table-striped table-condensed"> wraps
    // an inner <table class="table-striped"> with actual detail rows. Target the inner one.
    const table = doc.querySelector('form table table.table-striped') || doc.querySelector('form table.table-striped') || doc.querySelector('table.table-striped');
    if (!table) return null;
    const rows = table.querySelectorAll('tr');
    const fields = {};
    const skipLabels = new Set(['课程名','课程号']);
    rows.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) return;
      const l1 = tds[0]?.textContent?.trim().replace(/：/g,'') || '';
      const v1 = tds[1]?.textContent?.trim() || '';
      if (l1 && v1 && l1.length < 20 && !/^\d+$/.test(l1) && !skipLabels.has(l1)) fields[l1] = v1;
      if (tds.length >= 4) {
        const l2 = tds[2]?.textContent?.trim().replace(/：/g,'') || '';
        const v2 = tds[3]?.textContent?.trim() || '';
        if (l2 && v2 && l2.length < 20 && !/^\d+$/.test(l2) && !skipLabels.has(l2)) fields[l2] = v2;
      }
    });
    return fields;
  } catch(e) { console.warn(TAG, 'detail fetch:', e); return null; }
}

// ─── §7. Shadow DOM Host ──────────────────────────────────
const host = document.createElement('div');
host.id = 'nextthuxk-host';
host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1d1d1f;';
(document.documentElement||document.body).appendChild(host);
const shadow = host.attachShadow({ mode: 'open' });
$ = id => shadow.getElementById(id);

// ─── §8. CSS ──────────────────────────────────────────────
const CSS = `
#nextthuxk-inner{position:fixed;inset:0;pointer-events:none}
#nextthuxk-launch{position:fixed;bottom:28px;right:28px;pointer-events:all;width:56px;height:56px;border-radius:28px;background:linear-gradient(135deg,#7c6aef,#6366f1);color:#fff;border:none;font-size:22px;cursor:pointer;box-shadow:0 4px 20px rgba(99,102,241,.45);transition:transform .2s,box-shadow .2s;display:flex;align-items:center;justify-content:center}
#nextthuxk-launch:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(99,102,241,.55)}
#nextthuxk-dashboard{position:fixed;inset:0;background:rgba(245,245,247,.97);backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);pointer-events:all;display:flex;flex-direction:column;transform:translateY(100%);opacity:0;transition:transform .5s cubic-bezier(.16,1,.3,1),opacity .4s ease}
#nextthuxk-dashboard.active{transform:translateY(0);opacity:1}
.nx-header{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;background:rgba(255,255,255,.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,0,0,.06);flex-shrink:0}
.nx-logo{font-size:17px;font-weight:700;background:linear-gradient(135deg,#7c6aef,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-.2px}
.nx-exit{padding:8px 18px;border-radius:20px;background:#ff3b30;color:#fff;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .2s;font-family:inherit}
.nx-exit:hover{opacity:.85}
.nx-main{flex:1;display:flex;overflow:hidden}
.nx-left{width:50%;border-right:1px solid rgba(0,0,0,.06);display:flex;flex-direction:column;overflow:hidden}
.nx-right{width:50%;display:flex;flex-direction:column;overflow-y:auto}
.nx-search-bar{padding:16px 20px;background:rgba(255,255,255,.5);border-bottom:1px solid rgba(0,0,0,.04);flex-shrink:0}
.nx-search-wrap{position:relative}
.nx-search{width:100%;padding:11px 44px 11px 16px;border-radius:12px;border:1.5px solid rgba(0,0,0,.07);background:rgba(255,255,255,.9);font-size:14px;outline:none;transition:border-color .2s;box-sizing:border-box;font-family:inherit}
.nx-search:focus{border-color:#7c6aef}
.nx-search-clear{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:24px;height:24px;border:none;border-radius:999px;background:transparent;color:#8e8e93;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;pointer-events:none;transition:background .15s,color .15s,opacity .15s;font-family:inherit}
.nx-search-clear.show{opacity:1;pointer-events:auto}
.nx-search-clear:hover{background:rgba(0,0,0,.06);color:#1d1d1f}
.nx-filters{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.nx-chip{padding:6px 14px;border-radius:20px;border:1.5px solid rgba(0,0,0,.08);background:#fff;font-size:12px;font-weight:500;cursor:pointer;transition:all .15s;font-family:inherit;color:#1d1d1f}
.nx-chip.on{background:#7c6aef;color:#fff;border-color:#7c6aef}
.nx-list{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:10px}
.nx-card{background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 1px 8px rgba(0,0,0,.04);transition:transform .15s,box-shadow .15s;cursor:pointer}
.nx-card:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,.07)}
.nx-card-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
.nx-card-name{font-size:14px;font-weight:600;color:#1d1d1f;flex:1;margin-right:8px}
.nx-card-credit{font-size:13px;font-weight:700;color:#f59e0b;white-space:nowrap}
.nx-tags{display:flex;gap:5px;flex-wrap:wrap}
.nx-tag{display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600}
.nx-tag-ok{background:rgba(52,199,89,.12);color:#34c759}
.nx-tag-no{background:rgba(255,59,48,.12);color:#ff3b30}
.nx-tag-req{background:rgba(124,106,239,.12);color:#7c6aef}
.nx-tag-ele{background:rgba(0,122,255,.12);color:#007aff}
.nx-tag-opt{background:rgba(255,149,0,.12);color:#ff9500}
.nx-tag-sel{background:rgba(52,199,89,.18);color:#28a745}
.nx-card-detail{max-height:0;overflow:hidden;transition:max-height .3s ease;margin-top:0}
.nx-card.open .nx-card-detail{max-height:80px;margin-top:8px}
.nx-card-detail-inner{font-size:12px;color:#86868b;line-height:1.6;padding-top:4px;border-top:1px solid rgba(0,0,0,.05)}
.nx-vol{font-size:11px;color:#7c6aef;margin-top:3px;display:flex;gap:10px;flex-wrap:wrap}
.nx-vol span{white-space:nowrap}
.nx-comp{margin-top:5px;position:relative;height:18px;background:rgba(0,0,0,.04);border-radius:9px;overflow:hidden}
.nx-comp-bar{position:absolute;left:0;top:0;height:100%;border-radius:9px;opacity:.25;transition:width .3s}
.nx-comp-txt{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600}
.nx-prob-line{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px}
.nx-prob-label{font-size:10px;color:#86868b}
.nx-prob-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap}
.nx-prob-pill-muted{background:rgba(142,142,147,.12);color:#86868b}
.nx-card-actions{display:flex;gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap}
.nx-detail-btn,.nx-select-btn,.nx-drop-btn{padding:4px 14px;border-radius:8px;font-size:11px;cursor:pointer;font-family:inherit;font-weight:600;border:none;transition:opacity .15s}
.nx-detail-btn{border:1px solid rgba(124,106,239,.3);background:rgba(124,106,239,.08);color:#7c6aef}
.nx-select-btn{background:linear-gradient(135deg,#34c759,#30d158);color:#fff}
.nx-drop-btn{background:rgba(255,59,48,.12);color:#ff3b30;border:1px solid rgba(255,59,48,.25)}
.nx-detail-btn:hover,.nx-select-btn:hover,.nx-drop-btn:hover{opacity:.8}
.nx-detail-btn:disabled,.nx-select-btn:disabled,.nx-drop-btn:disabled{opacity:.5;cursor:not-allowed}
.nx-zy-select,.nx-type-select{padding:4px 8px;border-radius:8px;border:1px solid rgba(0,0,0,.1);font-size:11px;font-family:inherit;background:#fff;cursor:pointer}
.nx-vol-info{font-size:11px;font-weight:600;color:#7c6aef;padding:3px 10px;border-radius:8px;background:rgba(124,106,239,.1);white-space:nowrap}
.nx-inline-prob{display:inline-flex;align-items:center;justify-content:center;min-width:44px;padding:0 2px;font-size:11px;font-weight:700;white-space:nowrap;flex-shrink:0}
.nx-vol-btn{width:26px;height:26px;border-radius:6px;border:1px solid rgba(0,0,0,.1);background:#fff;font-size:12px;cursor:pointer;font-family:inherit;color:#1d1d1f;transition:background .15s;padding:0;display:flex;align-items:center;justify-content:center}
.nx-vol-btn:hover:not(:disabled){background:rgba(124,106,239,.1)}
.nx-vol-btn:disabled{opacity:.3;cursor:not-allowed}
.nx-card.nx-selected{border-left:3px solid #34c759}
.nx-toast{position:fixed;top:80px;left:50%;transform:translateX(-50%);padding:10px 24px;border-radius:12px;font-size:13px;font-weight:600;z-index:200;pointer-events:none;display:none;transition:opacity .3s;box-shadow:0 4px 20px rgba(0,0,0,.15)}
.nx-toast-ok{background:rgba(52,199,89,.95);color:#fff}
.nx-toast-err{background:rgba(255,59,48,.95);color:#fff}
.nx-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:100;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s}
.nx-modal-mask.show{opacity:1;pointer-events:all}
.nx-modal{background:#fff;border-radius:16px;width:680px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.2);transform:translateY(20px);transition:transform .25s}
.nx-modal-mask.show .nx-modal{transform:translateY(0)}
.nx-modal-head{display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid rgba(0,0,0,.06);flex-shrink:0}
.nx-modal-title{font-size:16px;font-weight:700;color:#1d1d1f}
.nx-modal-close{width:32px;height:32px;border-radius:16px;border:none;background:rgba(0,0,0,.05);cursor:pointer;font-size:18px;color:#86868b;display:flex;align-items:center;justify-content:center;transition:background .15s}
.nx-modal-close:hover{background:rgba(0,0,0,.1)}
.nx-modal-body{padding:20px 24px;overflow-y:auto;flex:1}
.nx-modal-row{display:flex;margin-bottom:12px;font-size:13px;line-height:1.6}
.nx-modal-label{width:100px;flex-shrink:0;color:#86868b;font-weight:500;text-align:right;padding-right:12px}
.nx-modal-val{flex:1;color:#1d1d1f}
.nx-modal-val p{margin:0}
.nx-modal-loading{padding:40px;text-align:center;color:#86868b}
.nx-sec{padding:18px 22px;border-bottom:1px solid rgba(0,0,0,.05)}
.nx-sec-title{font-size:15px;font-weight:700;color:#1d1d1f;margin-bottom:10px;display:flex;align-items:center;gap:6px}
.nx-plans{display:flex;gap:10px;flex-wrap:wrap}
.nx-plan-card{padding:10px 14px;border-radius:12px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.04);cursor:pointer;transition:all .15s;flex:1;min-width:100px;text-align:center}
.nx-plan-card:hover{box-shadow:0 2px 12px rgba(0,0,0,.08)}
.nx-plan-card.active{border:2px solid #7c6aef}
.nx-plan-num{font-size:22px;font-weight:700;color:#7c6aef}
.nx-plan-lbl{font-size:11px;color:#86868b;margin-top:2px}
.nx-ai{display:flex;flex-direction:column;gap:8px}
.nx-inp{width:100%;padding:9px 13px;border-radius:10px;border:1.5px solid rgba(0,0,0,.07);background:#fff;font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;transition:border-color .15s}
.nx-inp:focus{border-color:#7c6aef}
.nx-ta{resize:vertical;min-height:72px}
.nx-ai-btn{padding:11px;border-radius:12px;background:linear-gradient(135deg,#7c6aef,#6366f1);color:#fff;border:none;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s;font-family:inherit}
.nx-ai-btn:hover{opacity:.9}
.nx-ai-btn:disabled{opacity:.5;cursor:not-allowed}
.nx-st{padding:4px 0;font-size:12px;color:#86868b}
.nx-st.err{color:#ff3b30}
.nx-st.ok{color:#34c759}
.nx-tt{width:100%;border-collapse:separate;border-spacing:3px}
.nx-tt th{padding:6px;font-size:11px;font-weight:600;color:#86868b;text-align:center}
.nx-tt td{padding:6px 4px;text-align:center;border-radius:8px;font-size:11px;background:rgba(0,0,0,.02);vertical-align:top;min-width:0}
.nx-tt td.nx-s{background:rgba(124,106,239,.1);color:#7c6aef;font-weight:600}
.nx-tt td.nx-c{background:rgba(255,59,48,.1);color:#ff3b30;border:1px dashed rgba(255,59,48,.3)}
.nx-tt-cell{position:relative}
.nx-tt-text{display:block;font-size:10px;line-height:1.3;word-break:break-all}
.nx-tt-line{display:flex;flex-direction:column;align-items:center;gap:2px;margin-bottom:3px}
.nx-tt-line:last-child{margin-bottom:0}
.nx-tt-prob{display:inline-block;padding:1px 6px;border-radius:999px;font-size:9px;font-weight:700;line-height:1.4}
.nx-tt-rm{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:rgba(0,0,0,.15);color:#fff;font-size:9px;line-height:14px;text-align:center;cursor:pointer;display:none}
.nx-tt td:hover .nx-tt-rm{display:inline-block}
.nx-tt-rm:hover{background:rgba(255,59,48,.7)}
.nx-spin{display:inline-block;width:16px;height:16px;border:2px solid rgba(124,106,239,.2);border-top-color:#7c6aef;border-radius:50%;animation:nxsp .6s linear infinite;vertical-align:middle}
@keyframes nxsp{to{transform:rotate(360deg)}}
.nx-empty{padding:40px 20px;text-align:center;color:#86868b;font-size:13px}
.nx-stage-item{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:8px;background:rgba(124,106,239,.06);margin-bottom:3px;font-size:12px}
.nx-stage-name{flex:1;font-weight:600;color:#1d1d1f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nx-stage-info{font-size:10px;color:#86868b;white-space:nowrap}
.nx-stage-rm{width:20px;height:20px;border-radius:10px;border:none;background:rgba(255,59,48,.1);color:#ff3b30;font-size:11px;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center}
.nx-stage-rm:hover{background:rgba(255,59,48,.2)}
.nx-stage-btn{padding:4px 10px;border-radius:6px;border:1px solid rgba(124,106,239,.3);background:rgba(124,106,239,.08);color:#7c6aef;font-size:11px;cursor:pointer;font-family:inherit;font-weight:600;transition:opacity .15s}
.nx-stage-btn:hover{opacity:.8}
.nx-draft-card{padding:10px 12px;border-radius:10px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.04);margin-bottom:6px}
.nx-draft-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.nx-draft-name{font-size:13px;font-weight:700;color:#1d1d1f}
.nx-draft-info{font-size:11px;color:#86868b}
.nx-draft-acts{display:flex;gap:6px}
.nx-draft-acts button{padding:3px 10px;border-radius:6px;font-size:10px;cursor:pointer;font-family:inherit;font-weight:600;border:none;transition:opacity .15s}
.nx-draft-view{background:rgba(124,106,239,.1);color:#7c6aef}
.nx-draft-go{background:linear-gradient(135deg,#34c759,#30d158);color:#fff}
.nx-draft-del{background:rgba(255,59,48,.1);color:#ff3b30}
.nx-draft-acts button:hover{opacity:.8}
`;

// ─── §9. HTML ─────────────────────────────────────────────
const HTML = `
<div id="nextthuxk-inner">
  <button id="nextthuxk-launch" title="启动 NextTHUxk 下一代选课">✨</button>
  <div id="nextthuxk-toast" class="nx-toast"></div>
  <div id="nextthuxk-dashboard">
  <div class="nx-modal-mask" id="nextthuxk-modal">
    <div class="nx-modal">
      <div class="nx-modal-head">
        <div class="nx-modal-title" id="nextthuxk-modal-title">课程详情</div>
        <button class="nx-modal-close" id="nextthuxk-modal-close">✕</button>
      </div>
      <div class="nx-modal-body" id="nextthuxk-modal-body"><div class="nx-modal-loading">加载中…</div></div>
    </div>
  </div>
    <div class="nx-header">
      <div class="nx-logo">✨ NextTHUxk &nbsp;|&nbsp; 下一代选课</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span id="nextthuxk-cache-info" style="font-size:11px;color:#86868b"></span>
        <button id="nextthuxk-sem" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(124,106,239,.3);background:rgba(124,106,239,.08);color:#7c6aef;font-size:11px;cursor:pointer;font-family:inherit;font-weight:600" title="点击修改学期"></button>
        <button id="nextthuxk-grade" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(52,199,89,.3);background:rgba(52,199,89,.08);color:#34c759;font-size:11px;cursor:pointer;font-family:inherit;font-weight:600" title="点击修改年级"></button>
        <button id="nextthuxk-refresh" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(0,0,0,.1);background:#fff;font-size:11px;cursor:pointer;font-family:inherit">🔄 刷新数据</button>
        <button id="nextthuxk-check-update" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(0,0,0,.1);background:#fff;font-size:11px;cursor:pointer;font-family:inherit">🔔 检查更新</button>
        <button class="nx-exit" id="nextthuxk-exit">❌ 返回原选课系统</button>
      </div>
    </div>
    <div class="nx-main">
      <div class="nx-left">
        <div class="nx-search-bar">
          <div class="nx-search-wrap">
            <input type="text" class="nx-search" id="nextthuxk-search" placeholder="🔍 搜索课程名称、教师、课程号…">
            <button type="button" class="nx-search-clear" id="nextthuxk-search-clear" aria-label="清空搜索">×</button>
          </div>
          <div class="nx-filters" id="nextthuxk-filters">
            <button class="nx-chip on" data-f="all">全部</button>
            <button class="nx-chip" data-f="available">可选</button>
            <button class="nx-chip" data-f="selected">已选</button>
            <button class="nx-chip" data-f="required">必修</button>
            <button class="nx-chip" data-f="elective">限选</button>
            <button class="nx-chip" data-f="sports">体育</button>
            <button class="nx-chip" data-f="plan">培养方案</button>
          </div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <select id="nx-filter-credits" class="nx-zy-select" style="flex:1">
              <option value="">全部学分</option>
              <option value="1">1学分</option>
              <option value="2">2学分</option>
              <option value="3">3学分</option>
              <option value="4">4学分</option>
              <option value="5+">5+学分</option>
            </select>
            <select id="nx-filter-day" class="nx-zy-select" style="flex:1">
              <option value="">不限周次</option>
              <option value="1">周一</option><option value="2">周二</option><option value="3">周三</option>
              <option value="4">周四</option><option value="5">周五</option><option value="6">周六</option><option value="7">周日</option>
            </select>
            <select id="nx-filter-period" class="nx-zy-select" style="flex:1">
              <option value="">不限大节</option>
              <option value="1">第1大节</option><option value="2">第2大节</option><option value="3">第3大节</option>
              <option value="4">第4大节</option><option value="5">第5大节</option><option value="6">第6大节</option>
            </select>
          </div>
        </div>
        <div class="nx-list" id="nextthuxk-list">
          <div class="nx-empty">点击右下角 ✨ 按钮开始</div>
        </div>
      </div>
      <div class="nx-right">
        <div class="nx-sec">
          <div class="nx-sec-title">📋 我的培养方案</div>
          <div id="nextthuxk-plan" class="nx-plans"><div class="nx-st">等待加载…</div></div>
          <div id="nextthuxk-plan-detail" style="margin-top:8px;font-size:12px;color:#86868b"></div>
        </div>
        <div class="nx-sec">
          <div class="nx-sec-title">📅 课表预览 <span id="nextthuxk-preview-info" style="font-size:11px;color:#86868b;font-weight:400"></span></div>
          <div id="nextthuxk-preview-tt"><div class="nx-st">选课后自动生成预览</div></div>
          <button class="nx-stage-btn" id="nextthuxk-preview-reset" style="display:none;margin-top:6px">📅 返回当前已选课表</button>
        </div>
        <div class="nx-sec">
          <div class="nx-sec-title">💾 暂存课表</div>
          <div id="nextthuxk-stage-list"><div class="nx-st">暂无暂存课程</div></div>
          <div id="nextthuxk-stage-conflict" style="margin-top:4px"></div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <input type="text" class="nx-inp" id="nextthuxk-draft-name" placeholder="草稿名称（如：方案A）" style="flex:1;padding:6px 10px;font-size:12px;min-width:120px">
            <button class="nx-stage-btn" id="nextthuxk-save-draft">💾 保存草稿</button>
            <button class="nx-stage-btn" id="nextthuxk-save-selected">📋 存当前选课</button>
            <button class="nx-stage-btn" id="nextthuxk-preview-stage">📅 预览暂存</button>
            <button class="nx-stage-btn" id="nextthuxk-export">📤 导出</button>
            <button class="nx-stage-btn" id="nextthuxk-import">📥 导入</button>
          </div>
          <div id="nextthuxk-import-area" style="display:none;margin-top:6px">
            <textarea class="nx-inp nx-ta" id="nextthuxk-import-data" placeholder="粘贴导出的课表数据…" style="font-size:11px"></textarea>
            <div style="display:flex;gap:6px;margin-top:4px">
              <button class="nx-stage-btn" id="nextthuxk-import-confirm">确认导入到暂存区</button>
              <button class="nx-stage-btn" id="nextthuxk-import-cancel" style="color:#ff3b30;border-color:rgba(255,59,48,.3)">取消</button>
            </div>
          </div>
          <div id="nextthuxk-drafts" style="margin-top:8px"></div>
        </div>
        <div class="nx-sec">
          <div class="nx-sec-title">🤖 AI 选课助手</div>
          <div class="nx-ai">
            <input type="text" class="nx-inp" id="nextthuxk-api" placeholder="API Base URL（如 https://api.openai.com/v1）">
            <input type="text" class="nx-inp" id="nextthuxk-model" placeholder="模型名称（如 gpt-4o-mini、deepseek-chat）">
            <input type="password" class="nx-inp" id="nextthuxk-token" placeholder="API Token">
            <textarea class="nx-inp nx-ta" id="nextthuxk-pref" placeholder="我的选课偏好（如：周五下午空出来、优先给分好的老师、学分凑满30）"></textarea>
            <button class="nx-ai-btn" id="nextthuxk-ai">🚀 AI 智能排课</button>
            <div id="nextthuxk-ai-st" class="nx-st"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
`;

shadow.innerHTML = `<style>${CSS}</style>${HTML}`;

// ─── §10. State ───────────────────────────────────────────
let allCourses = [], planData = [], activeGroup = null;
let stageCart = [], savedDrafts = [];

function parseTimeSlots(timeStr) {
  if (!timeStr) return [];
  const slots = [];
  const dayLabels = ['周一','周二','周三','周四','周五','周六','周日'];
  const slotLabels = ['1-2节','3-4节','5-6节','7-8节','9-10节','11-12节'];
  // Format: 大节-星期(周次) e.g. "3-2(全周)" = 第3大节周二, "2-3(全周),4-2(全周)"
  const re = /(\d+)\s*[-–—]\s*(\d+)\s*\([^)]*\)/g;
  let m;
  while ((m = re.exec(timeStr)) !== null) {
    const dayNum = parseInt(m[1]); // 星期 1-7
    const dajie = parseInt(m[2]); // 大节 1-6
    if (dayNum >= 1 && dayNum <= 7 && dajie >= 1 && dajie <= 6) {
      slots.push({day: dayLabels[dayNum - 1], slot: slotLabels[dajie - 1]});
    }
  }
  return slots;
}

function addToStage(code, seq, flag, zy) {
  const c = allCourses.find(x => x.code === code && String(x.seq||'0') === String(seq||'0'));
  if (!c) return;
  if (stageCart.some(s => s.code === code && String(s.seq) === String(seq||'0'))) {
    showXkResult({ok:false, msg:'该课程已在暂存区'}); return;
  }
  stageCart.push({
    code: c.code, seq: c.seq || '0', name: c.name, teacher: c.teacher || '',
    time: c.time || '', credits: c.credits || 0, flag, zy: parseInt(zy) || 3,
    baseFlag: baseFlag(c),
  });
  renderStageCart();
  store.set('stageCart', stageCart);
  showXkResult({ok:true, msg:`已暂存「${c.name}」`});
}

function removeFromStage(idx) {
  stageCart.splice(idx, 1);
  renderStageCart();
  store.set('stageCart', stageCart);
  filterCourses();
}

function askReplaceDraft(name, courses) {
  if (savedDrafts.length < 5) {
    savedDrafts.push({id: Date.now(), name, courses: [...courses], createdAt: Date.now()});
    renderDrafts(); store.set('drafts', savedDrafts);
    return true;
  }
  const list = savedDrafts.map((d,i) => `${i+1}. ${d.name} (${d.courses.length}门·${d.courses.reduce((s,c)=>s+(c.credits||0),0)}学分)`).join('\n');
  const choice = prompt(`草稿已满(5/5)，输入要替换的编号(1-5)，取消则不保存：\n${list}`);
  if (!choice) return false;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= 5) { showXkResult({ok:false, msg:'已取消'}); return false; }
  savedDrafts[idx] = {id: Date.now(), name, courses: [...courses], createdAt: Date.now()};
  renderDrafts(); store.set('drafts', savedDrafts);
  return true;
}

function saveDraft() {
  const nameInput = $('nextthuxk-draft-name');
  const name = (nameInput?.value || '').trim() || `草稿${savedDrafts.length + 1}`;
  if (!stageCart.length) { showXkResult({ok:false, msg:'暂存区没有课程'}); return; }
  if (askReplaceDraft(name, stageCart)) {
    stageCart = [];
    if (nameInput) nameInput.value = '';
    renderStageCart(); store.set('stageCart', stageCart);
    filterCourses();
    showXkResult({ok:true, msg:`草稿「${name}」已保存`});
  }
}

function saveSelectedAsDraft() {
  const selected = allCourses.filter(c => c.selected);
  if (!selected.length) { showXkResult({ok:false, msg:'没有已选课程'}); return; }
  const courses = selected.map(c => ({
    code: c.code, seq: c.seq || '0', name: c.name, teacher: c.teacher || '',
    time: c.time || '', credits: c.credits || 0,
    flag: c.typeCode==='006'?'bx':c.typeCode==='008'?'xx':c.typeCode==='007'?'rx':'bx',
    zy: c.zy || 3, baseFlag: baseFlag(c),
  }));
  const d = new Date();
  const name = `已选课表 ${d.getMonth()+1}/${d.getDate()}`;
  if (askReplaceDraft(name, courses)) {
    showXkResult({ok:true, msg:`已选课程已保存为「${name}」`});
  }
}

function deleteDraft(idx) {
  savedDrafts.splice(idx, 1);
  renderDrafts();
  store.set('drafts', savedDrafts);
}

function detectConflicts(courses) {
  const slotMap = {};
  const conflicts = [];
  courses.forEach(c => {
    parseTimeSlots(c.time).forEach(({day, slot}) => {
      const k = day + '|' + slot;
      if (slotMap[k]) conflicts.push({day, slot, a: slotMap[k], b: c.name});
      else slotMap[k] = c.name;
    });
  });
  return conflicts;
}

const ZY_LIMITS = {
  bx: [[1,1],[2,2],[3,Infinity]], // 必修：1志愿1门, 2志愿2门, 3志愿无限
  xx: [[1,1],[2,2],[3,Infinity]], // 限选：同上
  rx: [[1,1],[2,2],[3,Infinity]], // 任选：同上
  ty: [[1,1],[2,1],[3,Infinity]], // 体育：1志愿1门, 2志愿1门, 3志愿无限
};

function zyTypeOf(course) {
  if (course.typeLabel === '体育' || course.typeCode === 'ty') return 'ty';
  return { '006': 'bx', '008': 'xx', '007': 'rx' }[course.typeCode] || 'bx';
}

function canAdjustZy(code, seq, targetZy) {
  const course = allCourses.find(c => c.code === code && String(c.seq||'0') === String(seq||'0'));
  if (!course) return false;
  const zt = zyTypeOf(course);
  let count = 0;
  allCourses.forEach(c => {
    if (!c.selected) return;
    if (c.code === code && String(c.seq||'0') === String(seq||'0')) return;
    if (zyTypeOf(c) !== zt) return;
    if (c.zy === targetZy) count++;
  });
  const limits = ZY_LIMITS[zt] || ZY_LIMITS.bx;
  return count < (limits[targetZy - 1]?.[1] || 0);
}

function exportDraft(draft) {
  const data = {v: 1, name: draft.name, courses: draft.courses.map(c => ({
    code: c.code, seq: c.seq, name: c.name, teacher: c.teacher, time: c.time,
    credits: c.credits, flag: c.flag, zy: c.zy, baseFlag: c.baseFlag,
  }))};
  const json = JSON.stringify(data);
  navigator.clipboard.writeText(json).then(
    () => showXkResult({ok:true, msg:`「${draft.name}」已复制到剪贴板，可分享给他人`}),
    () => {
      const ta = document.createElement('textarea');
      ta.value = json; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
      showXkResult({ok:true, msg:`「${draft.name}」已复制到剪贴板`});
    }
  );
}

function exportStageCart() {
  if (!stageCart.length) { showXkResult({ok:false, msg:'暂存区没有课程'}); return; }
  exportDraft({name: '暂存课表', courses: stageCart});
}

function importToStage(jsonStr) {
  try {
    const data = JSON.parse(jsonStr.trim());
    if (!data.courses || !Array.isArray(data.courses)) throw new Error('数据格式错误');
    let added = 0;
    data.courses.forEach(c => {
      if (!stageCart.some(s => s.code === c.code && String(s.seq) === String(c.seq))) {
        stageCart.push({
          code: c.code, seq: c.seq || '0', name: c.name || '', teacher: c.teacher || '',
          time: c.time || '', credits: c.credits || 0, flag: c.flag || 'bx', zy: c.zy || 3,
          baseFlag: c.baseFlag || (() => { const ac = allCourses.find(x => x.code === c.code); return ac ? baseFlag(ac) : 'rx'; })(),
        });
        added++;
      }
    });
    renderStageCart();
    store.set('stageCart', stageCart);
    showXkResult({ok:true, msg:`已导入 ${added} 门课程到暂存区`});
  } catch(e) { showXkResult({ok:false, msg:'导入失败: ' + e.message}); }
}

async function promoteDraft(draft) {
  const toast = $('nextthuxk-toast');
  const prog = (msg) => { if (toast) { toast.className='nx-toast'; toast.style.cssText='display:block;opacity:1;background:rgba(124,106,239,.95);color:#fff'; toast.textContent=msg; }};
  try {
    prog('⏳ 正在获取已选课程…');
    const current = await fetchSelectedCourses();
    for (let i = 0; i < current.length; i++) {
      prog(`⏳ 退选 ${i+1}/${current.length}: ${current[i].name}`);
      await dropCourse(current[i].code, current[i].seq);
      await new Promise(r => setTimeout(r, 1000));
    }
    for (let i = 0; i < draft.courses.length; i++) {
      const c = draft.courses[i];
      prog(`⏳ 选课 ${i+1}/${draft.courses.length}: ${c.name}`);
      await submitCourse(c.code, c.seq, c.zy || 3, c.flag || 'bx');
      await new Promise(r => setTimeout(r, 1500));
    }
    await refreshSelected();
    showXkResult({ok:true, msg:`课表「${draft.name}」已全部提交！`});
    const sel = allCourses.filter(c => c.selected);
    renderPreviewTT(sel, '当前已选');
  } catch(e) { showXkResult({ok:false, msg:'提交出错: ' + e.message}); }
}

// ─── §11. Render ──────────────────────────────────────────
function renderCourses(list) {
  const el = $('nextthuxk-list');
  if (!list.length) { el.innerHTML = '<div class="nx-empty">暂无匹配课程</div>'; return; }
  el.innerHTML = list.map(c => {
    const tags = [];
    if (c.available) tags.push('<span class="nx-tag nx-tag-ok">可选</span>');
    else tags.push('<span class="nx-tag nx-tag-no">已满</span>');
    if (c.selected) tags.push('<span class="nx-tag nx-tag-sel">已选</span>');
    if (c.attr==='必修') tags.push('<span class="nx-tag nx-tag-req">必修</span>');
    else if (c.attr==='限选') tags.push('<span class="nx-tag nx-tag-ele">限选</span>');
    else if (c.attr==='任选') tags.push('<span class="nx-tag nx-tag-opt">任选</span>');
    if (c.teacher) tags.push(`<span class="nx-tag">${esc(c.teacher)}</span>`);
    if (c.time) tags.push(`<span class="nx-tag">${esc(c.time)}</span>`);
    if (c.department) tags.push(`<span class="nx-tag">${esc(c.department)}</span>`);
    // Volunteer data + competition indicator
    const vc = volColor(c);
    const volParts = [];
    const isTy = c.attr === '体育' || c.department?.includes('体育') || c.name?.includes('体育') || c.typeLabel === '体育';
    if (isTy && c.volSports && c.volSports !== '0,0,0') {
      const s = fmtVol(c.volSports); if (s) volParts.push(`<span>体 ${s}</span>`);
    } else {
      if (c.volRequired && c.volRequired !== '0,0,0') { const s = fmtVol(c.volRequired); if (s) volParts.push(`<span>必 ${s}</span>`); }
      if (c.volElective && c.volElective !== '0,0,0') { const s = fmtVol(c.volElective); if (s) volParts.push(`<span>限 ${s}</span>`); }
      if (c.volOptional && c.volOptional !== '0,0,0') { const s = fmtVol(c.volOptional); if (s) volParts.push(`<span>任 ${s}</span>`); }
    }
    const volHtml = volParts.length ? `<div class="nx-vol">${volParts.join('')}</div>` : '';
    const defFlag = baseFlag(c);
    const volApplied = c.volApplied || 0;
    const volCap = c.volCapacity || c.capacity || 0;
    const compLabel = vc.level === 'easy' ? '竞争宽松' : vc.level === 'medium' ? '竞争适中' : vc.level === 'hard' ? '竞争激烈' : '';
    const compHtml = volCap > 0 ? `<div class="nx-comp">
      <div class="nx-comp-bar" style="width:${vc.pct}%;background:${vc.color}"></div>
      <span class="nx-comp-txt" style="color:${vc.color}">${volApplied}/${volCap} · ${compLabel}</span>
    </div>` : '';
    // Probability: show all allowed type × zy combinations
    const currentFlag = c.selected ? typeCodeToFlag(c.typeCode) : defFlag;
    const currentZy = c.selected ? (c.zy || 3) : 3;
    const currentProbHtml = currentProbLine(c, currentFlag, currentZy);
    const probHtml = fullProbGrid(c, defFlag);
    const detail = [
      c.capacity ? `容量${c.capacity}` : '',
      c.remaining !== undefined ? `余${c.remaining}` : '',
    ].filter(Boolean).join(' · ');
    // Action buttons
    let selectBtn;
    if (c.selected) {
      const volLabel = c.zy ? `<span class="nx-vol-info">第${c.zy}志愿 · ${esc(c.typeLabel||'')}</span>` : '';
      const p = currentProbMeta(c, currentFlag, currentZy);
      const probInline = `<span class="nx-inline-prob nx-card-inline-prob" data-code="${esc(c.code)}" data-seq="${esc(c.seq||'0')}" style="color:${p.color}">${p.percentLabel || p.label}</span>`;
      const canUp = c.zy && c.zy > 1 && canAdjustZy(c.code, c.seq||'0', c.zy - 1);
      const canDown = c.zy && c.zy < 3 && canAdjustZy(c.code, c.seq||'0', c.zy + 1);
      const upBtn = canUp ? `<button class="nx-vol-btn" data-dir="up" data-code="${esc(c.code)}" data-seq="${esc(c.seq||'0')}" data-zy="${c.zy}">▲</button>` : (c.zy > 1 ? `<button class="nx-vol-btn" disabled title="该志愿名额已满">▲</button>` : '');
      const downBtn = canDown ? `<button class="nx-vol-btn" data-dir="down" data-code="${esc(c.code)}" data-seq="${esc(c.seq||'0')}" data-zy="${c.zy}">▼</button>` : (c.zy < 3 ? `<button class="nx-vol-btn" disabled title="该志愿名额已满">▼</button>` : '');
      const sFlag = typeCodeToFlag(c.typeCode);
      const inStage = stageCart.some(s => s.code === c.code && String(s.seq) === String(c.seq||'0'));
      selectBtn = `${volLabel}${probInline}${upBtn}${downBtn}<button class="nx-stage-btn nx-add-stage-sel" data-code="${esc(c.code)}" data-seq="${esc(c.seq||'0')}" data-flag="${sFlag}" data-zy="${c.zy||3}"${inStage?' disabled':''}>${inStage?'已暂存':'暂存'}</button><button class="nx-drop-btn" data-code="${esc(c.code)}" data-seq="${esc(c.seq||'0')}">退选</button>`;
    } else if (c.available) {
      const inStage = stageCart.some(s => s.code === c.code && String(s.seq) === String(c.seq||'0'));
      const aFlags = allowedFlags(defFlag);
      const flagOpts = aFlags.map(f => `<option value="${f}"${defFlag===f?' selected':''}>${f==='bx'?'必修':f==='xx'?'限选':f==='rx'?'任选':'体育'}</option>`).join('');
      const p = currentProbMeta(c, currentFlag, currentZy);
      const probInline = `<span class="nx-inline-prob nx-card-inline-prob" data-code="${esc(c.code)}" data-seq="${esc(c.seq||'0')}" style="color:${p.color}">${p.percentLabel || p.label}</span>`;
      selectBtn = `<select class="nx-type-select" data-code="${esc(c.code)}" data-seq="${esc(c.seq||'0')}">${flagOpts}</select><select class="nx-zy-select" data-code="${esc(c.code)}" data-seq="${esc(c.seq||'0')}"><option value="3">3志愿</option><option value="2">2志愿</option><option value="1">1志愿</option></select>${probInline}<button class="nx-select-btn" data-code="${esc(c.code)}" data-seq="${esc(c.seq||'0')}">选课</button><button class="nx-stage-btn nx-add-stage" data-code="${esc(c.code)}" data-seq="${esc(c.seq||'0')}"${inStage?' disabled':''}>${inStage?'已暂存':'暂存'}</button>`;
    } else {
      selectBtn = `<span style="font-size:11px;color:#86868b">已满</span>`;
    }
    return `<div class="nx-card${c.selected?' nx-selected':''}" data-code="${esc(c.code)}" data-tid="${esc(c.teacherId||'')}">
      <div class="nx-card-head"><span class="nx-card-name">${esc(c.name)}</span><span class="nx-card-credit">${c.credits}学分</span></div>
      <div style="font-size:11px;color:#86868b;margin-bottom:3px">${esc(c.code)}${c.seq?' · '+esc(c.seq)+'课序':''}</div>
      <div class="nx-tags">${tags.join('')}</div>
      ${volHtml}${compHtml}${currentProbHtml}${probHtml}
      <div class="nx-card-detail"><div class="nx-card-detail-inner">${detail}</div></div>
      <div class="nx-card-actions">
        <button class="nx-detail-btn" data-code="${esc(c.code)}" data-tid="${esc(c.teacherId||'')}">📄 简介</button>
        ${selectBtn}
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.nx-card').forEach(card => {
    card.onclick = () => card.classList.toggle('open');
  });
  el.querySelectorAll('.nx-detail-btn').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); showCourseModal(btn.dataset.code, btn.dataset.tid); };
  });
  const syncCardProb = node => {
    const card = node.closest('.nx-card');
    if (!card) return;
    const code = card.dataset.code;
    const course = allCourses.find(x => x.code === code && String(x.seq||'0') === String(node.dataset.seq || '0'));
    if (!course || course.selected) return;
    const flag = card.querySelector('.nx-type-select')?.value || baseFlag(course);
    const zy = parseInt(card.querySelector('.nx-zy-select')?.value) || 3;
    const meta = currentProbMeta(course, flag, zy);
    const line = card.querySelector('.nx-current-prob');
    if (line) {
      line.dataset.flag = flag;
      line.dataset.zy = String(zy);
      const pill = line.querySelector('.nx-prob-pill');
      if (pill) {
        const detail = meta.ratioLabel && meta.ratioLabel !== '无数据' ? ` · ${meta.ratioLabel}` : '';
        pill.textContent = `${meta.flagLabel} · ${meta.zy}志愿 · ${meta.percentLabel || meta.label}${detail}`;
        pill.style.background = meta.bg;
        pill.style.color = meta.color;
        pill.classList.toggle('nx-prob-pill-muted', meta.prob < 0);
      }
    }
    const inline = card.querySelector('.nx-card-inline-prob');
    if (inline) {
      inline.textContent = meta.percentLabel || meta.label;
      inline.style.color = meta.color;
    }
  };
  el.querySelectorAll('.nx-type-select,.nx-zy-select').forEach(sel => {
    sel.onchange = e => {
      e.stopPropagation();
      syncCardProb(sel);
    };
  });
  el.querySelectorAll('.nx-select-btn').forEach(btn => {
    btn.onclick = async e => {
      e.stopPropagation();
      const code = btn.dataset.code;
      const seq = btn.dataset.seq;
      const actions = btn.parentElement;
      const flag = actions.querySelector('.nx-type-select')?.value || 'bx';
      const zy = actions.querySelector('.nx-zy-select')?.value || '3';
      btn.disabled = true; btn.textContent = '提交中…';
      try {
        const res = await submitCourse(code, seq, parseInt(zy), flag);
        showXkResult(res);
        if (res.ok) await refreshSelected();
      } catch(e) { showXkResult({ok:false, msg: e.message}); }
      finally { btn.disabled = false; btn.textContent = '选课'; }
    };
  });
  el.querySelectorAll('.nx-drop-btn').forEach(btn => {
    btn.onclick = async e => {
      e.stopPropagation();
      const code = btn.dataset.code;
      const seq = btn.dataset.seq;
      btn.disabled = true; btn.textContent = '退选中…';
      try {
        const res = await dropCourse(code, seq);
        showXkResult(res);
        if (res.ok) await refreshSelected();
      } catch(e) { showXkResult({ok:false, msg: e.message}); }
      finally { btn.disabled = false; btn.textContent = '退选'; }
    };
  });
  el.querySelectorAll('.nx-vol-btn').forEach(btn => {
    btn.onclick = async e => {
      e.stopPropagation();
      const code = btn.dataset.code;
      const seq = btn.dataset.seq;
      const curZy = parseInt(btn.dataset.zy) || 1;
      const dir = btn.dataset.dir;
      const targetZy = dir === 'up' ? curZy - 1 : curZy + 1;
      if (targetZy < 1) return;
      btn.disabled = true;
      try {
        const res = await changeVolunteer(code, seq, targetZy);
        showXkResult(res);
        if (res.ok) await refreshSelected();
      } catch(e) { showXkResult({ok:false, msg: e.message}); }
      finally { btn.disabled = false; }
    };
  });
  el.querySelectorAll('.nx-add-stage').forEach(btn => {
    btn.onclick = async e => {
      e.stopPropagation();
      const code = btn.dataset.code;
      const seq = btn.dataset.seq;
      const actions = btn.parentElement;
      const flag = actions.querySelector('.nx-type-select')?.value || 'bx';
      const zy = parseInt(actions.querySelector('.nx-zy-select')?.value) || 3;
      addToStage(code, seq, flag, zy);
      btn.textContent = '已暂存';
      btn.disabled = true;
    };
  });
  el.querySelectorAll('.nx-add-stage-sel').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      addToStage(btn.dataset.code, btn.dataset.seq, btn.dataset.flag || 'bx', parseInt(btn.dataset.zy) || 3);
      btn.textContent = '已暂存'; btn.disabled = true;
    };
  });
}

function fmtVol(v) {
  if (!v) return '';
  const cleaned = v.replace(/^\(.*?\)/, '');
  const parts = cleaned.split(',').map(n => parseInt(n) || 0);
  if (parts.every(n => n === 0)) return '';
  return parts.join('/');
}

function volColor(course) {
  const cap = course.volCapacity || course.capacity || 0;
  const applied = course.volApplied || 0;
  if (!cap || cap === 0) return { level: 'unknown', color: '#86868b', bg: 'rgba(134,134,139,.08)', pct: 0 };
  const ratio = applied / cap;
  if (ratio <= 0.8) return { level: 'easy', color: '#34c759', bg: 'rgba(52,199,89,.1)', pct: Math.min(ratio * 100, 100) };
  if (ratio <= 1.2) return { level: 'medium', color: '#ff9500', bg: 'rgba(255,149,0,.1)', pct: Math.min(ratio * 100, 100) };
  return { level: 'hard', color: '#ff3b30', bg: 'rgba(255,59,48,.1)', pct: Math.min(ratio * 100, 100) };
}

function parseVolArr(s) {
  if (!s) return null;
  const nums = String(s).match(/\d+/g);
  if (!nums || nums.length < 3) return null;
  return nums.slice(-3).map(n => parseInt(n, 10) || 0);
}

function calcProb(course, flag, zy) {
  const cap = parseInt(course.volCapacity || course.capacity || 0, 10) || 0;
  if (!cap) return { prob: -1, label: '无数据', color: '#86868b' };

  const zyIdx = zy - 1;

  // 体育：独立级联，只看体育志愿
  if (flag === 'ty') {
    const vols = parseVolArr(course.volSports);
    if (!vols) return { prob: -1, label: '无数据', color: '#86868b' };
    let rem = cap;
    for (let i = 0; i < zyIdx; i++) rem -= vols[i];
    return probResult(rem, vols[zyIdx]);
  }

  // 非体育课：在当前课程属性内按 1→2→3 志愿级联
  const vols = flag === 'bx'
    ? parseVolArr(course.volRequired)
    : flag === 'xx'
      ? parseVolArr(course.volElective)
      : parseVolArr(course.volOptional);
  if (!vols) return { prob: -1, label: '无数据', color: '#86868b' };
  let rem = cap;
  for (let i = 0; i < zyIdx; i++) rem -= vols[i];
  return probResult(rem, vols[zyIdx]);
}

function probResult(rem, applicants) {
  if (!Number.isFinite(rem) || !Number.isFinite(applicants)) {
    return { prob: -1, label: '无数据', percentLabel: '无数据', ratioLabel: '无数据', color: '#86868b' };
  }
  const remShown = Math.max(0, Math.round(rem));
  const applicantsShown = Math.max(0, Math.round(applicants));
  if (rem <= 0) return { prob: 0, label: '0%', percentLabel: '0%', ratioLabel: `${remShown}/${applicantsShown}`, color: '#ff3b30' };
  const prob = applicants === 0 ? 1 : Math.min(1, rem / applicants);
  if (!Number.isFinite(prob)) return { prob: -1, label: '无数据', percentLabel: '无数据', ratioLabel: '无数据', color: '#86868b' };
  let color;
  if (prob >= 0.8) color = '#34c759';
  else if (prob >= 0.5) color = '#ff9500';
  else color = '#ff3b30';
  const percentLabel = Math.round(prob * 100) + '%';
  const ratioLabel = `${remShown}/${applicantsShown}`;
  return { prob, label: percentLabel, percentLabel, ratioLabel, color };
}

function flagName(flag) {
  return flag === 'bx' ? '必修' : flag === 'xx' ? '限选' : flag === 'rx' ? '任选' : '体育';
}

function typeCodeToFlag(typeCode) {
  return typeCode === '006' ? 'bx' : typeCode === '008' ? 'xx' : typeCode === '007' ? 'rx' : typeCode === 'ty' ? 'ty' : 'bx';
}

function probBg(color) {
  if (color === '#34c759') return 'rgba(52,199,89,.14)';
  if (color === '#ff9500') return 'rgba(255,149,0,.14)';
  if (color === '#ff3b30') return 'rgba(255,59,48,.14)';
  return 'rgba(142,142,147,.12)';
}

function currentProbMeta(course, flag, zy) {
  const p = calcProb(course, flag, zy);
  return {
    ...p,
    flag,
    zy,
    flagLabel: flagName(flag),
    bg: probBg(p.color),
  };
}

function currentProbLine(course, flag, zy) {
  const p = currentProbMeta(course, flag, zy);
  const pillClass = p.prob >= 0 ? '' : ' nx-prob-pill-muted';
  const pillStyle = p.prob >= 0 ? `style="background:${p.bg};color:${p.color}"` : '';
  const detail = p.ratioLabel && p.ratioLabel !== '无数据' ? ` · ${p.ratioLabel}` : '';
  return `<div class="nx-prob-line nx-current-prob" data-code="${esc(course.code)}" data-seq="${esc(course.seq||'0')}" data-flag="${esc(flag)}" data-zy="${esc(zy)}"><span class="nx-prob-label">当前选法</span><span class="nx-prob-pill${pillClass}" ${pillStyle}>${esc(p.flagLabel)} · ${p.zy}志愿 · ${p.percentLabel || p.label}${detail}</span></div>`;
}

// Generate full probability grid for a course showing all allowed type × zy combinations
function fullProbGrid(courseOrAc, bf) {
  const aFlags = allowedFlags(bf);
  const rows = [];
  for (const f of aFlags) {
    const cells = [];
    for (let z = 1; z <= 3; z++) {
      const p = calcProb(courseOrAc, f, z);
      if (p.prob >= 0) {
        cells.push(`<span style="color:${p.color};font-weight:600">${z}志愿:${p.label}</span>`);
      } else {
        cells.push(`<span style="color:#86868b">${z}志愿:${p.label}</span>`);
      }
    }
    rows.push(`<span style="color:#86868b;font-size:9px">${flagName(f)}</span> ${cells.join(' ')}`);
  }
  return rows.length ? `<div style="margin-top:3px;line-height:1.4;font-size:9px">${rows.join('<br>')}</div>` : '';
}

function showXkResult(res) {
  let toast = $('nextthuxk-toast');
  if (!toast) return;
  toast.className = res.ok ? 'nx-toast nx-toast-ok' : 'nx-toast nx-toast-err';
  toast.textContent = (res.ok ? '✅ ' : '❌ ') + (res.msg || (res.ok ? '操作成功' : '操作失败'));
  toast.style.display = 'block';
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.style.display = 'none', 300); }, 2500);
}

async function refreshSelected() {
  const selected = await fetchSelectedCourses();
  const selMap = {};
  selected.forEach(s => { selMap[s.code + '_' + s.seq] = s; });
  allCourses.forEach(c => {
    const s = selMap[c.code + '_' + (c.seq || '0')];
    c.selected = !!s;
    if (s) { c.zy = s.zy; c.typeCode = s.typeCode; c.typeLabel = s.typeLabel; }
    else { c.zy = 0; c.typeCode = ''; c.typeLabel = ''; }
  });
  filterCourses();
  renderPreviewTT(allCourses.filter(c => c.selected), '当前已选');
}

// Track current preview state for interactive removal
let previewMode = 'selected'; // 'selected' | 'draft' | 'stage'
let previewDraftIdx = -1;

function renderPreviewTT(courses, label) {
  const el = $('nextthuxk-preview-tt');
  const info = $('nextthuxk-preview-info');
  const resetBtn = $('nextthuxk-preview-reset');
  if (!el) return;
  if (info) info.textContent = label || '';
  if (resetBtn) resetBtn.style.display = (label && label !== '当前已选') ? 'inline-block' : 'none';
  // Determine preview mode
  previewMode = (label === '当前已选') ? 'selected' : 'stage';
  if (label && label.startsWith('草稿「')) previewMode = 'draft';
  if (!courses.length) { el.innerHTML = '<div class="nx-st">暂无课程</div>'; return; }
  // Build grid with course refs for interactive removal
  const tt = {};
  courses.forEach((c, ci) => {
    const lbl = c.teacher ? `${c.name}(${c.teacher})` : c.name;
    // Get probability color
    let cellColor = '';
    let probLabel = '';
    let probBgColor = '';
    if (previewMode === 'selected' && c.zy) {
      const sf = typeCodeToFlag(c.typeCode);
      const p = calcProb(c, sf, c.zy);
      if (p.prob >= 0) {
        cellColor = p.color;
        probLabel = p.percentLabel || p.label;
        probBgColor = probBg(p.color);
      }
    } else if ((previewMode === 'stage' || previewMode === 'draft') && c.flag && c.zy) {
      const ac = allCourses.find(x => x.code === c.code && String(x.seq||'0') === String(c.seq||'0'));
      if (ac) {
        const p = calcProb(ac, c.flag, c.zy);
        if (p.prob >= 0) {
          cellColor = p.color;
          probLabel = p.percentLabel || p.label;
          probBgColor = probBg(p.color);
        }
      }
    }
    parseTimeSlots(c.time).forEach(({day, slot}) => {
      if (!tt[day]) tt[day] = {};
      const entry = {label: lbl, ci, code: c.code, seq: c.seq || '0', color: cellColor, probLabel, probBgColor};
      if (tt[day][slot]) {
        const old = tt[day][slot];
        const labels = (old.conflict ? old.items : [old]).concat(entry);
        tt[day][slot] = {label: labels.map(e => e.label).join(' / '), conflict: true, items: labels};
      } else tt[day][slot] = entry;
    });
  });
  const days = ['周一','周二','周三','周四','周五','周六','周日'];
  const sls = ['1-2节','3-4节','5-6节','7-8节','9-10节','11-12节'];
  let h = '<table class="nx-tt"><thead><tr><th></th>';
  days.forEach(d => h += `<th>${d}</th>`);
  h += '</tr></thead><tbody>';
  sls.forEach(slot => {
    h += `<tr><th>${slot}</th>`;
    days.forEach(day => {
      const val = tt[day]?.[slot];
      if (val) {
        const isC = val.conflict;
        const items = isC ? val.items : [val];
        const btns = items.map(it =>
          `<span class="nx-tt-rm" data-code="${esc(it.code)}" data-seq="${esc(it.seq)}" title="移除 ${esc(it.label)}">✕</span>`
        ).join('');
        const linesHtml = items.map(it => {
          const probHtml = it.probLabel ? `<span class="nx-tt-prob" style="background:${it.probBgColor};color:${it.color}">${it.probLabel}</span>` : '';
          return `<div class="nx-tt-line"><span class="nx-tt-text">${esc(it.label)}</span>${probHtml}</div>`;
        }).join('');
        // Use probability color for non-conflict cells in selected mode
        let cellClass = isC ? 'nx-c' : 'nx-s';
        let cellStyle = '';
        if (!isC && val.color) {
          const alpha = val.color === '#34c759' ? '.1' : val.color === '#ff9500' ? '.1' : '.1';
          cellStyle = `background:${val.color}${val.color.startsWith('rgba')?'':alpha};color:${val.color}`;
        }
        h += `<td class="${cellClass}" ${cellStyle?`style="${cellStyle}"`:''}><div class="nx-tt-cell">${linesHtml}${btns}</div></td>`;
      } else h += '<td></td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table>';
  const cr = courses.reduce((s,c) => s + (c.credits||0), 0);
  h += `<div class="nx-st ok" style="margin-top:6px">${courses.length}门课 · ${cr}学分</div>`;
  el.innerHTML = h;
  // Bind remove buttons
  el.querySelectorAll('.nx-tt-rm').forEach(btn => {
    btn.onclick = () => handlePreviewRemove(btn.dataset.code, btn.dataset.seq);
  });
}

async function handlePreviewRemove(code, seq) {
  if (previewMode === 'selected') {
    const c = allCourses.find(x => x.code === code && String(x.seq||'0') === String(seq));
    const name = c?.name || code;
    if (!confirm(`确认退选「${name}」？`)) return;
    const res = await dropCourse(code, seq);
    showXkResult(res);
    if (res.ok) {
      await launch();
    }
  } else if (previewMode === 'stage') {
    const idx = stageCart.findIndex(s => s.code === code && String(s.seq) === String(seq));
    const name = idx >= 0 ? stageCart[idx].name : code;
    if (!confirm(`从暂存区移除「${name}」？`)) return;
    removeFromStage(idx);
    renderPreviewTT(stageCart, $('nextthuxk-preview-info')?.textContent || '');
  } else if (previewMode === 'draft') {
    const draft = savedDrafts[previewDraftIdx];
    if (!draft) return;
    const idx = draft.courses.findIndex(s => s.code === code && String(s.seq) === String(seq));
    const name = idx >= 0 ? draft.courses[idx].name : code;
    if (!confirm(`从草稿移除「${name}」？`)) return;
    draft.courses.splice(idx, 1);
    await store.set('drafts', savedDrafts);
    renderDrafts();
    renderPreviewTT(draft.courses, `草稿「${draft.name}」预览`);
  }
}

function stageProbHtml(c) {
  const ac = allCourses.find(x => x.code === c.code && String(x.seq||'0') === String(c.seq||'0'));
  if (!ac) return '';
  const bf = c.baseFlag || baseFlag(ac);
  return fullProbGrid(ac, bf).replace(/margin-top:3px/, 'margin-top:2px');
}

function renderStageCart() {
  const el = $('nextthuxk-stage-list');
  if (!el) return;
  if (!stageCart.length) { el.innerHTML = '<div class="nx-st">暂无暂存课程，点击课程卡片上的「暂存」按钮添加</div>'; $('nextthuxk-stage-conflict').innerHTML=''; return; }
  el.innerHTML = stageCart.map((c, i) => {
    const bf = c.baseFlag || (() => { const ac = allCourses.find(x => x.code === c.code); return ac ? baseFlag(ac) : 'rx'; })();
    const aFlags = allowedFlags(bf);
    if (!aFlags.includes(c.flag)) { c.flag = aFlags[0]; store.set('stageCart', stageCart); }
    const flOpts = aFlags.map(f =>
      `<option value="${f}"${c.flag===f?' selected':''}>${f==='bx'?'必修':f==='xx'?'限选':f==='rx'?'任选':'体育'}</option>`
    ).join('');
    const zyOpts = [1,2,3].map(z =>
      `<option value="${z}"${c.zy===z?' selected':''}>${z}志愿</option>`
    ).join('');
    const prob = stageProbHtml(c);
    return `<div class="nx-stage-item" style="flex-direction:column;align-items:stretch;gap:2px">
      <div style="display:flex;align-items:center;gap:4px">
        <span class="nx-stage-name" style="min-width:80px">${esc(c.name)}${c.teacher?' <span style="color:#86868b;font-weight:400">'+esc(c.teacher)+'</span>':''}</span>
        <span class="nx-stage-info">${c.credits}学分</span>
        <select class="nx-stage-flag-sel" data-idx="${i}" style="padding:2px 4px;border-radius:6px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">${flOpts}</select>
        <select class="nx-stage-zy-sel" data-idx="${i}" style="padding:2px 4px;border-radius:6px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">${zyOpts}</select>
        <button class="nx-stage-rm" data-idx="${i}">✕</button>
      </div>
      ${prob}
    </div>`;
  }).join('');
  el.querySelectorAll('.nx-stage-flag-sel').forEach(sel => {
    sel.onchange = () => {
      const i = parseInt(sel.dataset.idx);
      stageCart[i].flag = sel.value;
      store.set('stageCart', stageCart);
      renderStageCart();
      if (previewMode === 'stage') renderPreviewTT(stageCart, $('nextthuxk-preview-info')?.textContent || '');
    };
  });
  el.querySelectorAll('.nx-stage-zy-sel').forEach(sel => {
    sel.onchange = () => {
      const i = parseInt(sel.dataset.idx);
      stageCart[i].zy = parseInt(sel.value);
      store.set('stageCart', stageCart);
      renderStageCart();
      if (previewMode === 'stage') renderPreviewTT(stageCart, $('nextthuxk-preview-info')?.textContent || '');
    };
  });
  el.querySelectorAll('.nx-stage-rm').forEach(btn => {
    btn.onclick = () => removeFromStage(parseInt(btn.dataset.idx));
  });
  // Conflict detection
  const cf = $('nextthuxk-stage-conflict');
  if (cf) {
    const conflicts = detectConflicts(stageCart);
    if (conflicts.length) {
      cf.innerHTML = conflicts.map(c =>
        `<div style="font-size:11px;color:#ff3b30">⚠ 时间冲突: ${esc(c.day)} ${esc(c.slot)} — ${esc(c.a)} 与 ${esc(c.b)}</div>`
      ).join('');
    } else cf.innerHTML = `<div style="font-size:11px;color:#34c759">✓ 无时间冲突</div>`;
  }
}

let expandedDraft = -1;

function draftCourseProbHtml(c) {
  const ac = allCourses.find(x => x.code === c.code && String(x.seq||'0') === String(c.seq||'0'));
  if (!ac) return '';
  const bf = c.baseFlag || baseFlag(ac);
  return fullProbGrid(ac, bf).replace(/margin-top:3px/, 'margin-top:2px');
}

function renderDrafts() {
  const el = $('nextthuxk-drafts');
  if (!el) return;
  if (!savedDrafts.length) { el.innerHTML = ''; return; }
  el.innerHTML = savedDrafts.map((d, di) => {
    const cr = d.courses.reduce((s,c) => s + (c.credits||0), 0);
    const dt = new Date(d.createdAt);
    const exp = expandedDraft === di;
    let courseList = '';
    if (exp && d.courses.length) {
      courseList = '<div class="nx-draft-courses" style="margin-top:6px;border-top:1px solid rgba(0,0,0,.06);padding-top:6px">';
      d.courses.forEach((c, ci) => {
        const bf = c.baseFlag || (() => { const ac = allCourses.find(x => x.code === c.code); return ac ? baseFlag(ac) : 'rx'; })();
        const aFlags = allowedFlags(bf);
        if (!aFlags.includes(c.flag)) { c.flag = aFlags[0]; store.set('drafts', savedDrafts); }
        const flOpts = aFlags.map(f =>
          `<option value="${f}"${c.flag===f?' selected':''}>${f==='bx'?'必修':f==='xx'?'限选':f==='rx'?'任选':'体育'}</option>`
        ).join('');
        const zyOpts = [1,2,3].map(z =>
          `<option value="${z}"${c.zy===z?' selected':''}>${z}志愿</option>`
        ).join('');
        const prob = draftCourseProbHtml(c);
        courseList += `<div style="display:flex;align-items:center;gap:4px;padding:3px 0;font-size:11px;border-bottom:1px solid rgba(0,0,0,.03)">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#1d1d1f">${esc(c.name)}</span>
          <span style="font-size:10px;color:#86868b">${c.credits}学分</span>
          <select class="nx-draft-flag" data-di="${di}" data-ci="${ci}" style="padding:1px 3px;border-radius:5px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">${flOpts}</select>
          <select class="nx-draft-zy" data-di="${di}" data-ci="${ci}" style="padding:1px 3px;border-radius:5px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">${zyOpts}</select>
          ${prob}
          <button class="nx-draft-crm" data-di="${di}" data-ci="${ci}" style="width:16px;height:16px;border-radius:8px;border:none;background:rgba(255,59,48,.1);color:#ff3b30;font-size:9px;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center">✕</button>
        </div>`;
      });
      courseList += '</div>';
    }
    const expIcon = exp ? '▼' : '▶';
    return `<div class="nx-draft-card"><div class="nx-draft-head"><span class="nx-draft-name" style="cursor:pointer" data-toggle="${di}">${expIcon} ${esc(d.name)}</span><span class="nx-draft-info">${d.courses.length}门 · ${cr}学分 · ${dt.getMonth()+1}/${dt.getDate()}</span></div><div class="nx-draft-acts"><button class="nx-draft-view" data-idx="${di}">预览 & 修改</button><button class="nx-draft-go" data-idx="${di}">提交选课</button><button class="nx-draft-export" data-idx="${di}">📤</button><button class="nx-draft-del" data-idx="${di}">删除</button></div>${courseList}</div>`;
  }).join('');
  el.querySelectorAll('[data-toggle]').forEach(span => {
    span.onclick = () => {
      const idx = parseInt(span.dataset.toggle);
      expandedDraft = expandedDraft === idx ? -1 : idx;
      renderDrafts();
    };
  });
  el.querySelectorAll('.nx-draft-flag').forEach(sel => {
    sel.onchange = () => {
      const di = parseInt(sel.dataset.di), ci = parseInt(sel.dataset.ci);
      savedDrafts[di].courses[ci].flag = sel.value;
      store.set('drafts', savedDrafts);
      renderDrafts();
      if (previewMode === 'draft' && previewDraftIdx === di) renderPreviewTT(savedDrafts[di].courses, `草稿「${savedDrafts[di].name}」预览`);
    };
  });
  el.querySelectorAll('.nx-draft-zy').forEach(sel => {
    sel.onchange = () => {
      const di = parseInt(sel.dataset.di), ci = parseInt(sel.dataset.ci);
      savedDrafts[di].courses[ci].zy = parseInt(sel.value);
      store.set('drafts', savedDrafts);
      renderDrafts();
      if (previewMode === 'draft' && previewDraftIdx === di) renderPreviewTT(savedDrafts[di].courses, `草稿「${savedDrafts[di].name}」预览`);
    };
  });
  el.querySelectorAll('.nx-draft-crm').forEach(btn => {
    btn.onclick = () => {
      const di = parseInt(btn.dataset.di), ci = parseInt(btn.dataset.ci);
      const name = savedDrafts[di].courses[ci].name;
      if (!confirm(`从草稿移除「${name}」？`)) return;
      savedDrafts[di].courses.splice(ci, 1);
      store.set('drafts', savedDrafts);
      renderDrafts();
      if (previewMode === 'draft' && previewDraftIdx === di) renderPreviewTT(savedDrafts[di].courses, `草稿「${savedDrafts[di].name}」预览`);
    };
  });
  el.querySelectorAll('.nx-draft-view').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      const d = savedDrafts[idx];
      if (d) { previewDraftIdx = idx; renderPreviewTT(d.courses, `草稿「${d.name}」预览`); }
    };
  });
  el.querySelectorAll('.nx-draft-go').forEach(btn => {
    btn.onclick = () => {
      const d = savedDrafts[parseInt(btn.dataset.idx)];
      if (!d) return;
      if (!confirm(`确定提交「${d.name}」？\n将先退选所有已选课程，再选入该草稿中的 ${d.courses.length} 门课程。`)) return;
      promoteDraft(d);
    };
  });
  el.querySelectorAll('.nx-draft-del').forEach(btn => {
    btn.onclick = () => deleteDraft(parseInt(btn.dataset.idx));
  });
  el.querySelectorAll('.nx-draft-export').forEach(btn => {
    btn.onclick = () => {
      const d = savedDrafts[parseInt(btn.dataset.idx)];
      if (d) exportDraft(d);
    };
  });
}

async function showCourseModal(code, teacherId) {
  const mask = $('nextthuxk-modal');
  const title = $('nextthuxk-modal-title');
  const body = $('nextthuxk-modal-body');
  // Find course in allCourses for title
  const c = allCourses.find(x => x.code === code);
  title.textContent = c ? `${c.name}（${code}）` : code;
  body.innerHTML = '<div class="nx-modal-loading"><span class="nx-spin"></span> 正在加载课程简介…</div>';
  mask.classList.add('show');
  const fields = await fetchCourseDetail(teacherId, code);
  if (!fields || !Object.keys(fields).length) {
    body.innerHTML = '<div class="nx-modal-loading">暂无课程简介信息</div>';
    return;
  }
  const order = ['课程编号','课程名称','总学时数','总学分','课程内容简介','Course Description','考核安排','联系人','教材及参考书','上课教师','选课指导语','先修要求','教师教学特色','Office Hour','成绩评定标准','参考书'];
  let html = '';
  for (const key of order) {
    if (fields[key] && fields[key].length > 0) {
      html += `<div class="nx-modal-row"><div class="nx-modal-label">${esc(key)}</div><div class="nx-modal-val">${esc(fields[key])}</div></div>`;
    }
  }
  // Add any remaining fields not in order
  for (const [k,v] of Object.entries(fields)) {
    if (!order.includes(k) && v && v.length > 0) {
      html += `<div class="nx-modal-row"><div class="nx-modal-label">${esc(k)}</div><div class="nx-modal-val">${esc(v)}</div></div>`;
    }
  }
  body.innerHTML = html || '<div class="nx-modal-loading">暂无信息</div>';
}

function checkPlanCoverage() {
  const codes = new Set();
  const detail = {};
  const collect = (list) => list.forEach(c => {
    codes.add(c.code);
    if (!detail[c.code]) detail[c.code] = c;
  });
  collect(allCourses.filter(c => c.selected));
  collect(stageCart);
  savedDrafts.forEach(d => collect(d.courses));

  // Check for 体育-type courses in all selections
  const isSports = (code) => {
    const c = allCourses.find(x => x.code === code);
    return c && ((c.department||'').includes('体育') || (c.attr||'')==='体育');
  };
  const hasSports = [...codes].some(isSports) || stageCart.some(c => isSports(c.code));

  // Check for 第二外国语
  const isSecondLang = (code) => {
    const c = allCourses.find(x => x.code === code);
    return c && (c.name.includes('第二外国语') || c.name.includes('二外'));
  };
  const hasSecondLang = [...codes].some(isSecondLang) || stageCart.some(c => isSecondLang(c.code));

  // Check for 英语进阶读写 (= 英语三)
  const isAdvEnglish = (code) => {
    const c = allCourses.find(x => x.code === code);
    return c && (c.name.includes('进阶读写') || c.name.includes('进阶'));
  };
  const hasAdvEnglish = [...codes].some(isAdvEnglish) || stageCart.some(c => isAdvEnglish(c.code));

  // Check for 英语阅读写作/听说交流 (= 英语一/二)
  const isBasicEnglish = (code) => {
    const c = allCourses.find(x => x.code === code);
    return c && (c.name.includes('阅读写作') || c.name.includes('听说交流'));
  };
  const hasBasicEnglish = (level) => [...codes].some(code => {
    const c = allCourses.find(x => x.code === code);
    return c && isBasicEnglish(code);
  }) || stageCart.some(c => isBasicEnglish(c.code));

  return planData.map(p => {
    let covered = codes.has(p.code);
    let coveredBy = covered && detail[p.code] ? (detail[p.code].teacher || detail[p.code].name) : '';

    // 体育: any 体育 course satisfies any 体育 plan requirement
    if (!covered && (p.attr==='体育' || p.name.includes('体育') || (p.group||'').includes('体育'))) {
      if (hasSports) { covered = true; coveredBy = '(已有体育课)'; }
    }
    // 英语(3) = 英语进阶读写 → 也可被第二外国语替代
    if (!covered && /英语\(3\)/.test(p.name)) {
      if (hasAdvEnglish) { covered = true; coveredBy = '(英语进阶读写)'; }
      else if (hasSecondLang) { covered = true; coveredBy = '(第二外国语替代)'; }
    }
    // 英语(1)/英语(2) = 英语阅读写作(A/B/C) + 英语听说交流(A/B/C)，不可用二外替代
    if (!covered && /英语\([12]\)/.test(p.name)) {
      if (hasBasicEnglish(p.name)) { covered = true; coveredBy = '(英语阅读写作/听说交流)'; }
    }

    return { ...p, covered, coveredBy };
  });
}

function renderPlanView(searchQuery) {
  const el = $('nextthuxk-list');
  if (!planData.length) { el.innerHTML = '<div class="nx-empty">暂无培养方案数据</div>'; return; }

  const coverage = checkPlanCoverage();
  let filtered = coverage;
  if (searchQuery) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(searchQuery) || p.code.includes(searchQuery) || (p.attr||'').includes(searchQuery));
  }

  // Group by group/attr
  const groups = {};
  filtered.forEach(p => {
    const g = p.group || p.attr || '其他';
    if (!groups[g]) groups[g] = [];
    groups[g].push(p);
  });

  // Summary
  const totalCr = coverage.reduce((s,c) => s + c.credits, 0);
  const coveredCr = coverage.filter(c => c.covered).reduce((s,c) => s + c.credits, 0);
  const totalN = coverage.length;
  const coveredN = coverage.filter(c => c.covered).length;

  let html = `<div style="margin-bottom:14px;padding:12px 16px;border-radius:12px;background:linear-gradient(135deg,rgba(124,106,239,.12),rgba(99,102,241,.06));font-size:13px">
    <strong>培养方案进度</strong>: ${coveredN}/${totalN}门 · ${coveredCr}/${totalCr}学分
    <div style="margin-top:6px;height:6px;background:rgba(0,0,0,.06);border-radius:3px;overflow:hidden">
      <div style="height:100%;width:${totalCr?Math.round(coveredCr/totalCr*100):0}%;background:linear-gradient(90deg,#34c759,#30d158);border-radius:3px"></div>
    </div>
  </div>`;

  for (const [groupName, courses] of Object.entries(groups)) {
    const gTotal = courses.reduce((s,c) => s + c.credits, 0);
    const gCovered = courses.filter(c => c.covered).reduce((s,c) => s + c.credits, 0);
    html += `<div style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:#1d1d1f;margin-bottom:6px;padding:5px 12px;background:rgba(124,106,239,.08);border-radius:8px;display:flex;justify-content:space-between">
        <span>${esc(groupName)}</span>
        <span style="font-size:11px;font-weight:400;color:${gCovered>=gTotal?'#34c759':'#86868b'}">${gCovered}/${gTotal}学分</span>
      </div>`;
    courses.forEach(p => {
      const icon = p.covered ? '✅' : '❌';
      const bg = p.covered ? 'rgba(52,199,89,.06)' : 'rgba(255,59,48,.04)';
      const statusHtml = p.covered
        ? `<span style="color:#34c759;font-size:11px;white-space:nowrap">${esc(p.coveredBy || '已满足')}</span>`
        : `<span style="color:#ff3b30;font-size:11px">未满足</span>`;
      html += `<div class="nx-stage-item" style="background:${bg};gap:8px">
        <span style="font-size:12px">${icon}</span>
        <span class="nx-stage-name">${esc(p.name)} <span style="color:#86868b;font-size:10px">${p.code}</span></span>
        <span class="nx-stage-info">${p.credits}学分</span>
        ${statusHtml}
      </div>`;
    });
    html += '</div>';
  }
  el.innerHTML = html;
}

function renderPlan(plan) {
  const el = $('nextthuxk-plan');
  const coverage = checkPlanCoverage();
  const groups = {};
  coverage.forEach(c => { const g = c.group||c.attr||'其他'; if(!groups[g])groups[g]=[]; groups[g].push(c); });
  el.innerHTML = Object.entries(groups).map(([name, items]) => {
    const cr = items.reduce((s,c)=>s+c.credits,0);
    const cov = items.filter(c=>c.covered).reduce((s,c)=>s+c.credits,0);
    return `<div class="nx-plan-card" data-g="${esc(name)}">
      <div class="nx-plan-num">${cov}<small style="font-size:12px;font-weight:400;color:#86868b">/${cr}学分</small></div>
      <div class="nx-plan-lbl">${esc(name)} (${items.length}门)</div>
    </div>`;
  }).join('');
  const detail = $('nextthuxk-plan-detail');
  const total = coverage.reduce((s,c)=>s+c.credits,0);
  const totalCov = coverage.filter(c=>c.covered).reduce((s,c)=>s+c.credits,0);
  detail.textContent = `共 ${coverage.length} 门，${totalCov}/${total} 学分已覆盖`;
}

// ─── §12. Filters ─────────────────────────────────────────
function filterCourses() {
  const q = $('nextthuxk-search').value.toLowerCase();
  updateSearchClear();
  const f = shadow.querySelector('.nx-chip.on')?.dataset.f || 'all';

  if (f === 'plan') {
    renderPlanView(q);
    return;
  }

  let list = allCourses;
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || c.code.includes(q) || (c.teacher||'').toLowerCase().includes(q));
  if (f==='available') list = list.filter(c => c.available);
  else if (f==='selected') {
    const seen = new Set();
    list = list.filter(c => {
      if (!c.selected) return false;
      const k = c.code + '_' + (c.seq || '0');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  else if (f==='required') list = list.filter(c => c.attr==='必修');
  else if (f==='elective') list = list.filter(c => c.attr==='限选');
  else if (f==='sports') list = list.filter(c => c.attr==='体育' || (c.department||'').includes('体育') || (c.department||'').includes('体武'));
  if (activeGroup) list = list.filter(c => (c.group||c.attr)===activeGroup);
  // Credits filter
  const cf = $('nx-filter-credits')?.value;
  if (cf) {
    if (cf === '5+') list = list.filter(c => c.credits >= 5);
    else list = list.filter(c => c.credits === parseInt(cf));
  }
  // Time filter
  const df = $('nx-filter-day')?.value;
  const pf = $('nx-filter-period')?.value;
  if (df || pf) {
    list = list.filter(c => {
      if (!c.time) return false;
      if (df && pf) return c.time.includes(`${df}-${pf}(`);
      if (df) return new RegExp(`${df}-\\d`).test(c.time);
      return new RegExp(`\\d+-${pf}\\(`).test(c.time);
    });
  }
  renderCourses(list);
}

function updateSearchClear() {
  const btn = $('nextthuxk-search-clear');
  const hasValue = !!$('nextthuxk-search').value.trim();
  btn.classList.toggle('show', hasValue);
}

function filterByGroup(g) {
  activeGroup = g;
  filterCourses();
}

// ─── §13. AI ──────────────────────────────────────────────
async function callAI() {
  const api = $('nextthuxk-api').value.trim();
  const model = $('nextthuxk-model').value.trim() || 'gpt-4o-mini';
  const token = $('nextthuxk-token').value.trim();
  const pref = $('nextthuxk-pref').value.trim();
  const st = $('nextthuxk-ai-st');
  const btn = $('nextthuxk-ai');
  if (!api||!token) { st.className='nx-st err'; st.textContent='❌ 请填写 API URL 和 Token'; return; }
  st.className='nx-st'; st.innerHTML='<span class="nx-spin"></span> AI 正在分析课程数据…';
  btn.disabled = true;
  try {
    // 必修课 + 体育课：AI需要逐门分析选择
    const bxTyCourses = allCourses.filter(c => c.attr==='必修' || c.attr==='体育' || (c.department||'').includes('体育')).map(c =>
      ({name:c.name,code:c.code,seq:c.seq||'',credits:c.credits,time:c.time||'',teacher:c.teacher||'',available:c.available,attr:c.attr,remaining:c.remaining}));
    // 当前已选课表（含时间和志愿）
    const selectedInfo = allCourses.filter(c=>c.selected).map(c=>({name:c.name,code:c.code,seq:c.seq,credits:c.credits,time:c.time,zy:c.zy,typeLabel:c.typeLabel}));
    const selectedCredits = selectedInfo.reduce((s,c)=>s+(c.credits||0),0);
    // 所有暂存课表
    const draftsInfo = savedDrafts.map(d => ({name:d.name,courses:d.courses.map(c=>({name:c.name,code:c.code,seq:c.seq,time:c.time,flag:c.flag,zy:c.zy,credits:c.credits}))}));
    const prompt = `你是清华大学选课AI助手。请根据以下信息推荐最优选课方案，确保无时间冲突。

## 用户信息
- 当前年级：${'大一大二大三大四'[GRADE-1] || '未知'}（第${GRADE}年本科）
- 当前学期：${SEM}

## 本学期可选的必修课和体育课（时间格式：星期-大节(周次)，如 3-2(全周) 表示周三第2大节）
${JSON.stringify(bxTyCourses,null,1)}

## 当前已选课表（${selectedInfo.length}门 · ${selectedCredits}学分）
${selectedInfo.length ? JSON.stringify(selectedInfo,null,1) : '无'}

## 已保存的暂存课表
${draftsInfo.length ? JSON.stringify(draftsInfo,null,1) : '无'}

## 用户偏好
${pref||'无特殊偏好，请合理推荐'}

重要约束：
1. 只推荐与用户年级匹配的课程。例如大三学生不应选大一大二的体育课(如体育(1)、体育(2))，应选体育(3)或以上。
2. 课程名中的数字通常表示年级段：体育(1)=大一体育，体育(2)=大二体育，体育(3)=大三体育。
3. 请根据已有课表的时间空隙，从必修课和体育课中选择合适的课程组合。
4. 对于任选课和通识课，不需要逐门搜索，只需根据已有课表的空闲时段给出选课方向建议即可。

返回纯JSON（不要markdown代码块），格式：
{"courses":[{"code":"课号","seq":"课序","name":"课名","credits":3,"time":"3-2(全周)","teacher":"教师","flag":"bx","zy":3,"reason":"推荐理由"}],"total_credits":30,"summary":"整体分析","suggestions":["对任选/通识课的建议"]}

flag: bx=必修 xx=限选 rx=任选 ty=体育。zy: 志愿号1-3。结果将直接存入暂存草稿。`;

    const resp = await fetch(api.replace(/\/+$/,'') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body: JSON.stringify({ model, messages:[{role:'system',content:'你是选课助手，只返回JSON。'},{role:'user',content:prompt}], temperature:0.3 })
    });
    if (!resp.ok) throw new Error('API HTTP '+resp.status);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('API 返回为空');
    const schedule = JSON.parse(content.replace(/```json?\n?/g,'').replace(/```/g,'').trim());

    // Load AI result into staging cart
    stageCart = (schedule.courses || []).map(c => {
      const ac = allCourses.find(x => x.code === c.code);
      return {
        code: c.code, seq: c.seq || '0', name: c.name || '', teacher: c.teacher || '',
        time: c.time || '', credits: c.credits || 0, flag: c.flag || 'bx', zy: c.zy || 3,
        baseFlag: c.baseFlag || (ac ? baseFlag(ac) : 'rx'),
      };
    });
    renderStageCart();
    renderPreviewTT(stageCart, 'AI 推荐方案');
    store.set('stageCart', stageCart);

    // Try to auto-save as draft
    const aiName = 'AI推荐';
    const saved = askReplaceDraft(aiName, stageCart);
    if (saved) {
      stageCart = [];
      renderStageCart();
      store.set('stageCart', stageCart);
    }

    const conflicts = detectConflicts(stageCart.length ? stageCart : (savedDrafts[savedDrafts.length-1]?.courses || []));
    st.className = conflicts.length ? 'nx-st err' : 'nx-st ok';
    let msg = conflicts.length
      ? `⚠ AI方案有 ${conflicts.length} 处时间冲突，请手动调整`
      : `✅ AI方案已生成！${schedule.courses?.length||0}门课 · ${schedule.total_credits||'?'}学分`;
    if (saved) msg += ` — 已保存为「${aiName}」`;
    else msg += ' — 仅保留在暂存区';
    if (schedule.summary) msg += `\n${schedule.summary}`;
    if (schedule.suggestions?.length) msg += `\n建议: ${schedule.suggestions.join('; ')}`;
    st.textContent = msg;

    store.set('config',{api,model,token,pref});
  } catch(e) {
    st.className='nx-st err'; st.textContent='❌ '+e.message;
  } finally { btn.disabled=false; }
}

// ─── §14. Flow ────────────────────────────────────────────
function mergeStaticData(catalog, volData, plan) {
  const courses = catalog.length ? catalog : plan.map(c=>({...c,available:true,teacher:'',time:'',capacity:'',selected:false,queue:''}));
  if (Object.keys(volData).length) {
    courses.forEach(c => {
      const key = c.seq ? c.code + '_' + c.seq : null;
      const v = (key && volData[key]) ? volData[key] : Object.values(volData).find(v => v.code === c.code);
      if (v) {
        c.volRequired = v.volRequired; c.volElective = v.volElective; c.volOptional = v.volOptional;
        c.volSports = v.volSports || '';
        c.volCapacity = v.capacity || c.capacity; c.volApplied = v.applied || 0;
        // 体育课优先使用体育志愿数据
        if ((c.attr === '体育' || c.department?.includes('体育') || c.name?.includes('体育')) && v.volSports) {
          c.volApplied = v.applied || 0;
          c.volCapacity = v.capacity || c.volCapacity;
        }
      }
    });
  }
  if (plan.length) {
    const pm = {}; plan.forEach(p => { pm[p.code] = p.attr; });
    courses.forEach(c => { if (!c.attr && pm[c.code]) c.attr = pm[c.code]; });
  }
  return courses;
}

function toggle(show) {
  const db = $('nextthuxk-dashboard');
  const btn = $('nextthuxk-launch');
  if (show) { db.classList.add('active'); btn.style.display='none'; host.style.pointerEvents='all'; }
  else { db.classList.remove('active'); setTimeout(()=>{btn.style.display='flex';},500); host.style.pointerEvents='none'; }
}

// Volunteer data updates at 8, 12, 16, 20 daily.
function volNeedsRefresh(volTs) {
  if (!volTs) return true;
  const now = new Date();
  const hours = [8, 12, 16, 20];
  let lastUpdate = new Date(now);
  lastUpdate.setHours(hours[0], 0, 0, 0);
  for (let i = hours.length - 1; i >= 0; i--) {
    const t = new Date(now); t.setHours(hours[i], 0, 0, 0);
    if (now >= t) { lastUpdate = t; break; }
    if (i === 0) { lastUpdate = new Date(now); lastUpdate.setDate(lastUpdate.getDate() - 1); lastUpdate.setHours(hours[hours.length - 1], 0, 0, 0); }
  }
  return volTs < lastUpdate.getTime();
}

function fmtTime(ts) {
  if (!ts) return '无';
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
}

const CUR_VER = '1.2.0';
let updateTimer = null;

function cmpVer(a, b) {
  const pa = a.replace(/^v/,'').split('.').map(Number);
  const pb = b.replace(/^v/,'').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i]||0) > (pb[i]||0)) return 1;
    if ((pa[i]||0) < (pb[i]||0)) return -1;
  }
  return 0;
}

async function checkUpdate() {
  try {
    const lastCheck = await store.get('lastUpdateCheck');
    if (lastCheck && Date.now() - lastCheck < 30 * 60 * 1000) return; // 30 min cooldown
    const resp = await fetch('https://api.github.com/repos/smartThise/NextTHUxk/releases/latest', { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    await store.set('lastUpdateCheck', Date.now());
    const remote = (data.tag_name || '').replace(/^v/,'');
    if (remote && cmpVer(remote, CUR_VER) > 0) {
      showUpdateBanner(remote, data.html_url);
    }
  } catch(e) { /* silent */ }
  // Periodic re-check every 30 min while panel is open
  if (!updateTimer) {
    updateTimer = setInterval(() => {
      store.set('lastUpdateCheck', 0);
      checkUpdate();
    }, 30 * 60 * 1000);
  }
}

function showUpdateBanner(ver, url) {
  const existing = $('nextthuxk-update-banner');
  if (existing) return;
  const db = $('nextthuxk-dashboard');
  if (!db) return;
  const banner = document.createElement('div');
  banner.id = 'nextthuxk-update-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:linear-gradient(90deg,#667eea,#764ba2);color:#fff;font-size:13px;border-radius:8px;margin:8px 0;">
      <span>发现新版本 v${esc(ver)}，建议更新获取最新功能与修复</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <a href="${url}" target="_blank" style="color:#fff;background:rgba(255,255,255,0.2);padding:4px 12px;border-radius:4px;text-decoration:none;font-size:12px;">前往下载</a>
        <button id="nextthuxk-update-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;line-height:1;">✕</button>
      </div>
    </div>`;
  db.prepend(banner);
  $('nextthuxk-update-close').onclick = () => banner.remove();
}

async function launch() {
  toggle(true);
  // Resolve semester: URL param > stored > prompt
  if (!SEM) {
    SEM = (await store.get('sem')) || '';
    if (!SEM) {
      SEM = prompt('请输入当前学期（如 2026-2027-1）：', '2026-2027-1') || '2026-2027-1';
    }
  }
  await store.set('sem', SEM);
  const semBtn = $('nextthuxk-sem');
  if (semBtn) semBtn.textContent = SEM;
  // Resolve grade: stored > prompt
  GRADE = (await store.get('grade')) || 0;
  if (!GRADE) {
    const g = prompt('请输入你的年级（仅影响 AI 对体育课的推荐，不影响其他功能）\n\n1=大一 2=大二 3=大三 4=大四：');
    if (g) GRADE = Math.max(1, Math.min(4, parseInt(g) || 0));
  }
  if (GRADE) await store.set('grade', GRADE);
  const gradeBtn = $('nextthuxk-grade');
  if (gradeBtn) gradeBtn.textContent = GRADE ? ['', '大一', '大二', '大三', '大四'][GRADE] : '未设置';
  const listEl = $('nextthuxk-list');
  listEl.innerHTML = '<div class="nx-empty"><span class="nx-spin"></span>&ensp;正在获取数据…</div>';
  try {
    // 1) Load static cache (catalog + plan, never auto-refresh)
    let sd = await store.get('staticData');
    // Force refresh if data structure version changed
    if (sd && sd.ver !== DATA_VER) {
      console.log(TAG, 'data version mismatch, clearing cache');
      sd = null;
      await store.set('staticData', null);
      await store.set('grade', 0); // re-detect grade
      GRADE = 0;
    }
    const needCatalog = !sd || !sd.catalog || sd.catalog.length < 100;

    // 2) Check if volunteer data needs refresh (16:00 / 20:00 schedule)
    const needVol = volNeedsRefresh(sd?.volTs);

    // Fetch what's needed
    let catalog = sd?.catalog || [];
    let plan = sd?.plan || [];
    let volData = sd?.volData || {};
    let volTs = sd?.volTs || 0;

    if (needCatalog) {
      console.log(TAG, 'fetching catalog + plan...');
      const [p, c] = await Promise.all([
        fetchTrainingPlan().catch(e=>{ console.warn(TAG,'plan:',e); return []; }),
        fetchCourseCatalog().catch(e=>{ console.warn(TAG,'catalog:',e); return []; }),
      ]);
      plan = p; catalog = c;
    }
    if (needCatalog || needVol) {
      console.log(TAG, needVol ? 'volunteer data stale, refreshing...' : 'fetching volunteer data...');
      volData = await fetchVolunteer().catch(e=>{ console.warn(TAG,'volunteer:',e); return {}; });
      volTs = Date.now();
    }
    // Save cache
    sd = { ver: DATA_VER, plan, catalog, volData, volTs, ts: sd?.ts || Date.now() };
    if (needCatalog) sd.ts = Date.now();
    await store.set('staticData', sd);

    // 3) Personal data: always real-time
    const selectedCourses = await fetchSelectedCourses().catch(e=>{ console.warn(TAG,'selected:',e); return []; });

    planData = plan;
    allCourses = mergeStaticData(catalog, volData, plan);
    const selMap = {};
    selectedCourses.forEach(s => { selMap[s.code + '_' + s.seq] = s; });
    allCourses.forEach(c => {
      const s = selMap[c.code + '_' + (c.seq || '0')];
      c.selected = !!s;
      if (s) { c.zy = s.zy; c.typeCode = s.typeCode; c.typeLabel = s.typeLabel; }
    });

    renderCourses(allCourses);
    renderPlan(planData);

    // Preview timetable from selected courses
    renderPreviewTT(allCourses.filter(c => c.selected), '当前已选');

    // Load staging data
    stageCart = (await store.get('stageCart')) || [];
    savedDrafts = (await store.get('drafts')) || [];
    // Migrate: add baseFlag to existing items that lack it
    let migrated = false;
    stageCart.forEach(c => {
      if (!c.baseFlag) { const ac = allCourses.find(x => x.code === c.code); c.baseFlag = ac ? baseFlag(ac) : 'rx'; migrated = true; }
    });
    savedDrafts.forEach(d => d.courses.forEach(c => {
      if (!c.baseFlag) { const ac = allCourses.find(x => x.code === c.code); c.baseFlag = ac ? baseFlag(ac) : 'rx'; migrated = true; }
    }));
    if (migrated) { store.set('stageCart', stageCart); store.set('drafts', savedDrafts); }
    renderStageCart();
    renderDrafts();

    // Cache info line
    const cacheEl = $('nextthuxk-cache-info');
    if (cacheEl) {
      const catAge = Math.round((Date.now() - sd.ts) / 60000);
      cacheEl.innerHTML = `课程数据 ${catAge}分钟前 · 志愿排队 ${fmtTime(volTs)}`;
    }

    // Restore AI config
    const cfg = await store.get('config');
    if (cfg) {
      if(cfg.api) $('nextthuxk-api').value=cfg.api;
      if(cfg.model) $('nextthuxk-model').value=cfg.model;
      if(cfg.token) $('nextthuxk-token').value=cfg.token;
      if(cfg.pref) $('nextthuxk-pref').value=cfg.pref;
    }
    console.log(TAG, `loaded ${allCourses.length} courses (${selectedCourses.length} selected)`, needVol ? '(vol refreshed)' : '(vol cached)');
  } catch(e) {
    listEl.innerHTML = `<div class="nx-empty nx-st err">❌ ${esc(e.message)}</div>`;
  }
  checkUpdate();
}

// ─── §15. Events ──────────────────────────────────────────
$('nextthuxk-launch').onclick = launch;
$('nextthuxk-exit').onclick = () => toggle(false);
$('nextthuxk-refresh').onclick = async () => {
  await store.set('staticData', null);
  launch();
};
$('nextthuxk-search').oninput = filterCourses;
$('nextthuxk-search-clear').onclick = () => {
  $('nextthuxk-search').value = '';
  filterCourses();
  $('nextthuxk-search').focus();
};
$('nx-filter-credits').onchange = filterCourses;
$('nx-filter-day').onchange = filterCourses;
$('nx-filter-period').onchange = filterCourses;
$('nextthuxk-sem').onclick = async () => {
  const s = prompt('修改学期（格式：2026-2027-1）：', SEM);
  if (s && s.trim()) {
    SEM = s.trim();
    await store.set('sem', SEM);
    $('nextthuxk-sem').textContent = SEM;
    await store.set('staticData', null);
    launch();
  }
};
$('nextthuxk-grade').onclick = async () => {
  const g = prompt('修改年级（仅影响 AI 对体育课的推荐，不影响其他功能）\n\n1=大一 2=大二 3=大三 4=大四：', String(GRADE));
  if (g) {
    GRADE = Math.max(1, Math.min(4, parseInt(g) || 3));
    await store.set('grade', GRADE);
    $('nextthuxk-grade').textContent = ['', '大一', '大二', '大三', '大四'][GRADE];
  }
};
$('nextthuxk-check-update').onclick = async () => {
  await store.set('lastUpdateCheck', 0);
  const btn = $('nextthuxk-check-update');
  btn.textContent = '⏳ 检查中...';
  btn.disabled = true;
  await checkUpdate();
  btn.textContent = '🔔 检查更新';
  btn.disabled = false;
  // If no banner appeared, show "up to date"
  if (!$('nextthuxk-update-banner')) {
    const toast = document.createElement('div');
    toast.id = 'nextthuxk-update-banner';
    toast.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:#34c759;color:#fff;font-size:13px;border-radius:8px;margin:8px 0;">
      <span>当前已是最新版本 v${CUR_VER}</span>
      <button onclick="this.closest('#nextthuxk-update-banner').remove()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;">✕</button>
    </div>`;
    $('nextthuxk-dashboard')?.prepend(toast);
  }
};
shadow.querySelectorAll('.nx-chip').forEach(chip => {
  chip.onclick = () => {
    shadow.querySelectorAll('.nx-chip').forEach(c=>c.classList.remove('on'));
    chip.classList.add('on');
    filterCourses();
  };
});
$('nextthuxk-ai').onclick = callAI;
$('nextthuxk-save-draft').onclick = saveDraft;
$('nextthuxk-save-selected').onclick = saveSelectedAsDraft;
$('nextthuxk-export').onclick = exportStageCart;
$('nextthuxk-preview-stage').onclick = () => {
  if (!stageCart.length) { showXkResult({ok:false, msg:'暂存区没有课程'}); return; }
  previewMode = 'stage';
  renderPreviewTT(stageCart, '暂存区预览');
};
$('nextthuxk-import').onclick = () => {
  const area = $('nextthuxk-import-area');
  if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
};
$('nextthuxk-import-confirm').onclick = () => {
  const data = $('nextthuxk-import-data')?.value;
  if (!data) return;
  importToStage(data);
  $('nextthuxk-import-area').style.display = 'none';
  $('nextthuxk-import-data').value = '';
};
$('nextthuxk-import-cancel').onclick = () => {
  $('nextthuxk-import-area').style.display = 'none';
};
$('nextthuxk-preview-reset').onclick = () => {
  renderPreviewTT(allCourses.filter(c => c.selected), '当前已选');
};
// Modal close
$('nextthuxk-modal-close').onclick = () => $('nextthuxk-modal').classList.remove('show');
$('nextthuxk-modal').onclick = e => { if (e.target === $('nextthuxk-modal')) $('nextthuxk-modal').classList.remove('show'); };
chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'nextthuxk-toggle') launch();
});

console.log(TAG, 'ready');
})();
