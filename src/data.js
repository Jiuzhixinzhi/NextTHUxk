// ═══════════════════════════════════════════════════════════════
// NextTHUxk — Data: 数据抓取与解析（课程目录、志愿、选退课 API）
// ═══════════════════════════════════════════════════════════════
var NX = NX || {};

// ─── Parsing Helpers ──────────────────────────────────────────

NX.parsePlan = function (doc) {
  const rows = doc.querySelectorAll('table#kcTable tr');
  const out = [];
  let sem = '', season = '';
  for (const row of rows) {
    const tds = row.querySelectorAll('td');
    if (!tds.length) continue;
    const cells = [...tds].map(td => td.textContent.trim().replace(/\s+/g, ' '));
    for (const td of tds) {
      const t = td.textContent.trim();
      const sm = t.match(/(\d{4}-\d{4}学年)/); if (sm) sem = sm[1];
      const sn = t.match(/^(秋|春|夏)$/);         if (sn) season = sn[1];
    }
    const code = cells.find(c => /^\d{8}$/.test(c));
    if (!code) continue;
    const name = cells.find(c => c.length > 1 && !/^\d+$/.test(c) && !['必修','限选','任选','秋','春','夏'].includes(c) && !c.includes('学年'));
    const attr = cells.find(c => ['必修','限选','任选'].includes(c));
    const credit = cells.find(c => /^\d{1,2}(\.\d)?$/.test(c) && c !== code);
    const group = cells.find(c => c.length > 2 && !['必修','限选','任选'].includes(c) && !/^\d/.test(c) && !c.includes('学年') && c !== name);
    if (name) out.push({ semester: sem + ' ' + season, code, name: name.replace(/\s+/g, ''), attr: attr || '', credits: parseFloat(credit) || 0, group: group || '' });
  }
  return out;
};

NX.parseFullProgram = function (doc) {
  const rows = doc.querySelectorAll('#content_1 table tbody tr.trr2');
  const out = [];
  let grp = '', attr = '';
  for (const row of rows) {
    const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
    if (cells.length >= 9) { grp = cells[0]; attr = cells[1] || attr; }
    const idx = cells.length >= 9 ? 2 : 0;
    const code = cells[idx], name = cells[idx + 1];
    if (code && name && /^\d+$/.test(code))
      out.push({ code, name, credits: parseFloat(cells[idx + 2]) || 0, attr, group: grp, semester: '' });
  }
  return out;
};

NX.parseCatalog = function (doc) {
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
    const teacherLink = tds[5]?.querySelector('a[href*="showJsDetail"]');
    const teacherHref = teacherLink?.getAttribute('href') || '';
    const teacherIdMatch = teacherHref.match(/p_jsh=([^&]+)/);
    const teacherId = teacherIdMatch ? teacherIdMatch[1] : '';
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
      xkTextNote: cell(11),
      courseFeature: cell(12),
      grade: cell(13),
      tongshiGroup: cell(18),
      gradCapacity: parseInt(cell(8)) || 0,
      gradRemaining: parseInt(cell(9)) || 0,
      volRequired: '', volElective: '', volOptional: '', volSports: '',
    });
  });
  return out;
};

NX.parseVolFromHtml = function (html) {
  const map = {};
  const regex = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*\]/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const key = m[1] + '_' + m[2];
    map[key] = {
      code: m[1], seq: m[2],
      capacity: parseInt(m[3]) || 0,
      applied: parseInt(m[4]) || 0,
      volRequired: m[5],
      volElective: m[6],
      volOptional: m[7],
    };
  }
  return map;
};

NX.parseVolSportsFromHtml = function (html) {
  const map = {};
  const regex = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*\]/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const key = m[1] + '_' + m[2];
    map[key] = {
      code: m[1], seq: m[2],
      capacity: parseInt(m[3]) || 0,
      applied: parseInt(m[4]) || 0,
      volSports: m[5],
    };
  }
  return map;
};

// ─── Course Type Helpers ──────────────────────────────────────

NX.courseFlag = function (course) {
  const a = (course.attr || '').trim();
  if (a === '限选') return 'xx';
  if (a === '任选') return 'rx';
  if (a === '体育') return 'ty';
  if (a === '必修') return 'bx';
  return 'rx';
};

NX.isSportsCourse = function (course) {
  return (course.attr || '') === '体育'
    || (course.department || '').includes('体育')
    || (course.name || '').includes('体育')
    || course.typeLabel === '体育'
    || course.typeCode === 'ty';
};

NX.baseFlag = function (course) {
  if (NX.isSportsCourse(course)) return 'ty';
  return NX.courseFlag(course);
};

NX.allowedFlags = function (bf) {
  if (bf === 'ty') return ['ty'];
  if (bf === 'bx') return ['bx', 'xx', 'rx'];
  if (bf === 'xx') return ['xx', 'rx'];
  return ['rx'];
};

NX.typeCodeToFlag = function (typeCode) {
  return typeCode === '006' ? 'bx' : typeCode === '008' ? 'xx' : typeCode === '007' ? 'rx' : typeCode === 'ty' ? 'ty' : 'bx';
};

NX.zyTypeOf = function (course) {
  if (course.typeLabel === '体育' || course.typeCode === 'ty') return 'ty';
  return { '006': 'bx', '008': 'xx', '007': 'rx' }[course.typeCode] || 'bx';
};

// ─── Data Fetching ────────────────────────────────────────────

// 从列表页 HTML 解析分页控件："第 1 页 / 共 304 页（共 6,078 条记录）"
NX.parsePagerInfo = function (html) {
  const pages = /共\s*(\d+)\s*页/.exec(html);
  const total = /共\s*([\d,，]+)\s*条/.exec(html);
  return {
    pages: pages ? parseInt(pages[1]) : 0,
    total: total ? parseInt(total[1].replace(/[,，]/g, '')) : 0,
  };
};

NX.fetchTrainingPlan = async function () {
  const { state, fetchPage, parsePlan, parseFullProgram } = NX;
  const { SEM, BASE, isZhjwxk, isZhjw } = state;
  if (isZhjwxk) {
    const html = await fetchPage(BASE + '/jhBks.vjhBksPyfakcbBs.do?m=showBksZxZdxjxjhXmxqkclist&p_xnxq=' + SEM);
    return parsePlan(new DOMParser().parseFromString(html, 'text/html'));
  }
  if (isZhjw) {
    const listHtml = await fetchPage(BASE + '/jhBks.vjhBksPyfakcbBs.do?m=grPyfabks&theRole=bks&theModule=pyfa');
    if (listHtml.includes('accessDenied')) return [];
    const m = /fajhh=(\d+)/.exec(listHtml);
    if (!m) return [];
    const html = await fetchPage(BASE + '/jhBks.vjhBksPyfakcbBs.do?m=index2&theModule=pyfa&p_fajhh=' + m[1]);
    return parseFullProgram(new DOMParser().parseFromString(html, 'text/html'));
  }
  return [];
};

// 从查询页 HTML 提取 form[name=frm] 全部字段默认值（v1.3.11：完整表单 POST，1:1 模拟 UI）
NX.extractFormFields = function (html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.querySelector('form[name="frm"]');
    if (!form) return null;
    const fields = {};
    form.querySelectorAll('input[name]').forEach(el => { fields[el.name] = el.value || ''; });
    form.querySelectorAll('select[name]').forEach(el => {
      const opt = el.querySelector('option[selected]') || el.querySelector('option');
      fields[el.name] = opt ? (opt.value || '') : '';
    });
    return fields;
  } catch (e) { return null; }
};

// catalog 查询的 POST 基础字段：结构字段照抄表单，查询条件一律置空（等价"全部"），
// 分批时仅 p_kkdwnm 填值。pathContent 置空规避 GBK 编码差异。
NX.catalogPostFields = function (formFields, page, dept) {
  const f = {
    m: 'kkxxSearch',
    page: String(page),
    token: formFields.token || '',
    'p_sort.p1': '', 'p_sort.p2': '',
    'p_sort.asc1': formFields['p_sort.asc1'] || 'true',
    'p_sort.asc2': formFields['p_sort.asc2'] || 'true',
    p_xnxq: NX.state.SEM,
    pathContent: '', showtitle: '',
    p_kch: '', p_kcm: '', p_zjjsxm: '', p_xkwzsm: '',
    p_kkdwnm: dept || '',
    p_kcflm: '', p_skxq: '', p_skjc: '', p_rxklxm: '',
    p_kctsm: '', p_ssnj: '', p_bkskyl_ig: '', p_yjskyl_ig: '',
  };
  return new URLSearchParams(f);
};
NX.parseDeptCodes = function (html) {
  const sel = /<select[^>]*name="p_kkdwnm"[^>]*>([\s\S]*?)<\/select>/i.exec(html);
  if (!sel) return [];
  const out = [];
  const re = /<option[^>]*value=(["'])(.*?)\1/gi;   // 兼容单/双引号属性
  let m;
  while ((m = re.exec(sel[1])) !== null) {
    const v = m[2].trim();
    if (v) out.push(v);
  }
  return out;
};

NX.fetchCourseCatalog = async function () {
  const { state, fetchPage, parseCatalog, pagedFetch, parsePagerInfo } = NX;
  if (!state.isZhjwxk) return [];
  const { SEM, BASE } = state;
  const firstUrl = BASE + '/xkBks.vxkBksJxjhBs.do?m=kkxxSearch&p_xnxq=' + SEM;
  let firstHtml = '';
  try { firstHtml = await fetchPage(firstUrl); }
  catch (e) { console.warn(NX.TAG, 'catalog first page:', e); return []; }
  const pager = parsePagerInfo(firstHtml);
  if (pager.pages > 0) console.log(NX.TAG, 'catalog pager: 共', pager.pages, '页 /', pager.total, '条');

  const parseCat = html => {
    const batch = parseCatalog(new DOMParser().parseFromString(html, 'text/html'));
    return { items: batch, hasData: batch.length > 0 };
  };
  const formFields = NX.extractFormFields(firstHtml);
  const formAction = BASE + '/xkBks.vxkBksJxjhBs.do';
  // v1.3.11：完整表单 POST 翻页（UI 同款请求路径）。GET 翻页被服务器限制在 ~293 页
  //（v1.3.5~1.3.10 实测：并发/顺序/节流均无效；POST 表单才是 UI 的翻页方式）
  const postPage = async (p, dept) => {
    const resp = await fetch(formAction, {
      method: 'POST', credentials: 'include',
      body: NX.catalogPostFields(formFields || {}, p, dept),
    });
    const buf = await resp.arrayBuffer();
    return new TextDecoder('gbk').decode(buf);
  };

  // 兜底：GET 全量顺序（POST 不可用时）
  const fetchWholeGet = async () => pagedFetch({
    firstHtml,
    fetchPage: p => fetchPage(BASE + '/xkBks.vxkBksJxjhBs.do?m=kkxxSearch&p_xnxq=' + SEM + '&page=' + p + '&_t=' + Date.now()),
    parse: parseCat,
    maxPages: 320, concurrency: 1, throttle: 50,
    dedupe: c => c.code + '_' + c.seq,
    expectPages: pager.pages, label: 'catalog',
  });
  const finishWhole = (all, tag) => {
    if (pager.total > 0 && all.length < pager.total) {
      console.warn(NX.TAG, 'catalog got', all.length, '/', pager.total, '— data may be incomplete');
      NX.state.fetchWarn = '⚠ 课程数据可能不完整：' + all.length + '/' + pager.total + '（详见 Console）';
    }
    console.log(NX.TAG, 'catalog total:', all.length, 'courses (' + tag + ')');
    return all;
  };

  // ── A. 完整表单 POST 全量翻页（UI 同款；探测第 1 页有效性）──
  let postOk = false;
  try {
    const probeHtml = await postPage(1, '');
    postOk = parseCat(probeHtml).hasData;
  } catch (e) { postOk = false; }
  if (!postOk) {
    console.warn(NX.TAG, 'form-POST pagination unavailable, fallback to GET');
    return finishWhole(await fetchWholeGet(), 'get-fallback');
  }

  // ── B. 院系分批（完整表单 + p_kkdwnm；探针校验过滤生效）──
  const deptCodes = NX.parseDeptCodes(firstHtml);
  const grabDept = async code => {
    let fh = '';
    try { fh = await postPage(0, code); }
    catch (e) { return { items: [], total: 0, pages: 0 }; }
    const dp = parsePagerInfo(fh);
    const items = await pagedFetch({
      firstHtml: fh,
      fetchPage: p => postPage(p, code),
      parse: parseCat,
      maxPages: 100, concurrency: 1, throttle: 30,
      dedupe: c => c.code + '_' + c.seq,
      expectPages: dp.pages, label: 'catalog/' + code,
    });
    return { items, total: dp.total, pages: dp.pages };
  };
  if (deptCodes.length && pager.pages > 12) {
    const probe = await grabDept(deptCodes[0]);
    if (probe.pages > 0 && probe.pages < pager.pages) {
      console.log(NX.TAG, 'dept-split engaged:', deptCodes.length, 'depts, probe', deptCodes[0], 'has', probe.pages, 'pages vs global', pager.pages);
      const all = [...probe.items];
      let sumTotals = probe.total, incompleteDepts = probe.items.length < probe.total ? 1 : 0;
      await NX.runPool(deptCodes.slice(1), 4, async code => {
        try {
          const r = await grabDept(code);
          all.push(...r.items);
          sumTotals += r.total;
          if (r.items.length < r.total) incompleteDepts++;
        } catch (e) { incompleteDepts++; console.warn(NX.TAG, 'dept', code, e); }
      });
      const seen = new Set(); const uniq = [];
      for (const c of all) { const k = c.code + '_' + c.seq; if (!seen.has(k)) { seen.add(k); uniq.push(c); } }
      if (incompleteDepts > 0) {
        console.warn(NX.TAG, incompleteDepts, 'depts incomplete');
        NX.state.fetchWarn = '⚠ ' + incompleteDepts + ' 个院系的课程数据可能不完整（详见 Console）';
      }
      console.log(NX.TAG, 'catalog total:', uniq.length, 'unique · 院系条目合计', sumTotals, '· 全局分页计数', pager.total);
      return uniq;
    }
    console.warn(NX.TAG, 'p_kkdwnm filter ineffective even via form-POST');
  }

  // ── C. POST 全量翻页（无院系分批）──
  const all = await pagedFetch({
    firstHtml,
    fetchPage: p => postPage(p, ''),
    parse: parseCat,
    maxPages: 320, concurrency: 1, throttle: 50,
    dedupe: c => c.code + '_' + c.seq,
    expectPages: pager.pages, label: 'catalog',
  });
  return finishWhole(all, 'form-post');
};

NX.fetchVolunteer = async function () {
  const { state, fetchPage, parseVolFromHtml, parseVolSportsFromHtml, pagedFetch } = NX;
  if (!state.isZhjwxk) return {};
  const { SEM, BASE } = state;
  try {
    const mkUrl = m => p => BASE + '/xkBks.xkBksZytjb.do?m=' + m + '&p_xnxq=' + SEM + '&page=' + p + '&_t=' + Date.now();
    const mkFirst = m => BASE + '/xkBks.xkBksZytjb.do?m=' + m + '&p_xnxq=' + SEM;
    const parseVol = parseFn => html => {
      const batch = parseFn(html);
      const arr = Object.values(batch);
      return { items: arr, hasData: arr.length > 0 };
    };
    const grabWhole = async (m, parseFn, maxPages, fh, pager) => pagedFetch({
      firstHtml: fh,
      fetchPage: p => fetchPage(mkUrl(m)(p)),
      parse: parseVol(parseFn),
      maxPages, concurrency: 1, throttle: 50,
      dedupe: v => v.code + '_' + v.seq,
      expectPages: pager.pages, label: m,
    });
    const grab = async (m, parseFn, maxPages) => {
      let fh = '';
      try { fh = await fetchPage(mkFirst(m)); }
      catch (e) { console.warn(NX.TAG, m, 'first page:', e); return []; }
      const pager = NX.parsePagerInfo(fh);
      // v1.3.10 院系分批（查询深 >12 页才值得）：绕开单查询深分页上限 + 提速；
      // 探针校验过滤有效性，无效/异常自动回退全量顺序
      const depts = NX.parseDeptCodes(fh);
      if (depts.length && pager.pages > 12) {
        const grabDeptVol = async code => {
          const du = p => BASE + '/xkBks.xkBksZytjb.do?m=' + m + '&p_xnxq=' + SEM + '&p_kkdwnm=' + code + '&page=' + p + '&_t=' + Date.now();
          let dfh = '';
          try { dfh = await fetchPage(du(0)); }
          catch (e) { return { items: [], pages: 0 }; }
          const dp = NX.parsePagerInfo(dfh);
          const items = await pagedFetch({
            firstHtml: dfh, fetchPage: p => fetchPage(du(p)),
            parse: parseVol(parseFn),
            maxPages: 100, concurrency: 1, throttle: 30,
            dedupe: v => v.code + '_' + v.seq,
            expectPages: dp.pages, label: m + '/' + code,
          });
          return { items, pages: dp.pages };
        };
        const probe = await grabDeptVol(depts[0]);
        if (probe.pages > 0 && probe.pages < pager.pages) {
          const all = [...probe.items];
          await NX.runPool(depts.slice(1), 4, async code => {
            try { all.push(...(await grabDeptVol(code)).items); }
            catch (e) { console.warn(NX.TAG, m, 'dept', code, e); }
          });
          const seen = new Set(); const uniq = [];
          for (const v of all) { const k = v.code + '_' + v.seq; if (!seen.has(k)) { seen.add(k); uniq.push(v); } }
          console.log(NX.TAG, m, 'dept-split:', uniq.length, 'courses');
          return uniq;
        }
        console.warn(NX.TAG, m, 'p_kkdwnm filter ineffective, fallback to whole-query');
      }
      return grabWhole(m, parseFn, maxPages, fh, pager);
    };
    const volItems = await grab('tbzySearchBR', parseVolFromHtml, 200);
    const allMap = {};
    volItems.forEach(v => { allMap[v.code + '_' + v.seq] = v; });
    console.log(NX.TAG, 'volunteer data:', Object.keys(allMap).length, 'courses');
    try {
      const sportsItems = await grab('tbzySearchTy', parseVolSportsFromHtml, 20);
      const sportsMap = {};
      sportsItems.forEach(v => { sportsMap[v.code + '_' + v.seq] = v; });
      for (const [key, val] of Object.entries(sportsMap)) {
        if (allMap[key]) Object.assign(allMap[key], val);
        else allMap[key] = val;
      }
      console.log(NX.TAG, 'sports volunteer data:', Object.keys(sportsMap).length, 'courses');
    } catch (e) { console.warn(NX.TAG, 'sports volunteer fetch:', e); }
    return allMap;
  } catch (e) { console.warn(NX.TAG, 'volunteer fetch:', e); return {}; }
};

// ─── Course Selection/Drop API ────────────────────────────────

// 通用：fetch GET 搜索页拿 token → fetch POST 表单 → 从响应 HTML 检测结果
NX.fetchFormSubmit = async function (searchUrl, postFields) {
  const { state, fetchPage } = NX;
  const BASE = state.BASE;
  try {
    // 1) GET 搜索页，提取 token
    const html = await fetchPage(searchUrl);
    const tokenMatch = html.match(/name="token"\s+value="([^"]+)"/);
    if (!tokenMatch) return { ok: false, msg: '无法获取 token' };

    // 2) POST 表单数据
    postFields.token = tokenMatch[1];
    const resp = await fetch(BASE + '/xkBks.vxkBksXkbBs.do', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(postFields),
    });
    if (!resp.ok) return { ok: false, msg: 'HTTP ' + resp.status };

    // 3) 读响应 HTML，检测是否需要排队
    const buf = await resp.arrayBuffer();
    const respText = new TextDecoder('gbk').decode(buf);
    if (respText.includes('accessDenied')) return { ok: false, msg: '操作被拒绝' };
    if (respText.includes('加入队列成功')) return { ok: true, submitted: true, msg: '已加入候补队列' };
    if (respText.includes('选课成功')) return { ok: true, submitted: true, msg: '选课成功' };

    // 4) 检测是否弹出"是否排队"的 confirm
    // 服务器返回 confirm("课程xxx 已满...是否排队？") → 需要再次 POST m=saveBksKcDl
    // 关键：第二次 POST 必须用响应页面里的新 token（第一次的 token 已被消耗）
    const isQueueConfirm = respText.includes('是否排队') && respText.includes('saveBksKcDl');
    if (isQueueConfirm) {
      await new Promise(r => setTimeout(r, 1500));
      // 从第一次 POST 响应中提取新 token（原 token 已被消耗）
      const newTokenMatch = respText.match(/name="token"\s+value="([^"]+)"/);
      const queueFields = { ...postFields, m: 'saveBksKcDl' };
      if (newTokenMatch) queueFields.token = newTokenMatch[1];
      const queueResp = await fetch(BASE + '/xkBks.vxkBksXkbBs.do', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(queueFields),
      });
      if (!queueResp.ok) return { ok: false, msg: '排队提交 HTTP ' + queueResp.status };
      const qBuf = await queueResp.arrayBuffer();
      const qText = new TextDecoder('gbk').decode(qBuf);
      if (qText.includes('加入队列成功')) return { ok: true, submitted: true, msg: '已加入候补队列' };
      if (qText.includes('选课成功')) return { ok: true, submitted: true, msg: '选课成功' };
      return { ok: true, submitted: true };
    }

    return { ok: true, submitted: true };
  } catch (e) {
    console.error('[NextTHUxk] fetchFormSubmit ERROR:', e);
    return { ok: false, msg: e.message };
  }
};

// 轮询等待：总时长 >= 原固定 sleep，提前满足提前返回（平均省 1s+，最坏不劣于原来）
NX.pollUntil = async function (fn, delay, tries) {
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, delay));
    if (await fn()) return true;
  }
  return false;
};

NX.submitCourse = async function (code, seq, zy, flag) {
  const { state, fetchFormSubmit, fetchSelectedCourses } = NX;
  const { SEM, BASE } = state;
  zy = zy || 3;
  flag = flag || 'bx';
  const mSearch = { bx: 'bxSearch', xx: 'xxSearch', rx: 'rxSearch', ty: 'tySearch' }[flag] || 'bxSearch';
  const mVal = { bx: 'saveBxKc', xx: 'saveXxKc', rx: 'saveRxKc', ty: 'saveTyKc' }[flag] || 'saveBxKc';
  const extra = flag === 'rx' ? '&is_zyrxk=1' : '';
  const searchUrl = BASE + '/xkBks.vxkBksXkbBs.do?m=' + mSearch + '&p_xnxq=' + SEM + '&tokenPriFlag=' + flag + extra;
  const idName = { bx: 'p_bxk_id', xx: 'p_xxk_id', rx: 'p_rx_id', ty: 'p_rxTy_id' }[flag];
  const zyName = { bx: 'p_bxk_xkzy', xx: 'p_xxk_xkzy', rx: 'p_rx_xkzy', ty: 'p_rxTy_xkzy' }[flag];
  const fields = { m: mVal, p_xnxq: SEM, tokenPriFlag: flag, page: '' };
  fields[idName] = SEM + ';' + code + ';' + seq + ';';
  fields[zyName] = String(zy);
  if (flag === 'rx') { fields.is_zyrxk = '1'; fields.p_rxklxm = ''; }
  if (flag === 'ty') { fields.rxTyType = ''; }
  const res = await fetchFormSubmit(searchUrl, fields);
  if (!res.submitted) return res;
  // 轮询验证：已选列表或候补队列中出现即视为成功（总等待 ≥ 原 2s 固定延时）
  const hitSel = () => fetchSelectedCourses().then(sel =>
    sel.some(s => s.code === code && String(s.seq) === String(seq)));
  if (await NX.pollUntil(hitSel, 700, 3)) return { ok: true, msg: '选课成功' };
  // 已满课提交后可能进入候补队列而非直接选上
  const cand = await NX.fetchCandidateCourses();
  const foundQueue = cand.some(s => s.code === code && String(s.seq) === String(seq));
  return foundQueue ? { ok: true, msg: '已加入候补队列' } : { ok: false, msg: '选课未生效，请确认课程类型是否正确' };
};

NX.dropCourse = async function (code, seq) {
  const { state, fetchFormSubmit, fetchSelectedCourses } = NX;
  const { SEM, BASE } = state;
  // 判断是候补课程还是已选课程
  const cand = state.candidateCourses || [];
  const isQueue = cand.some(c => c.code === code && String(c.seq) === String(seq));
  if (isQueue) {
    // 候补课程：m=dlDelete，从 dlSearchTab 页面拿 token
    const searchUrl = BASE + '/xkBks.vxkBksXkbBs.do?m=dlSearchTab&p_xnxq=' + SEM;
    const res = await fetchFormSubmit(searchUrl, {
      m: 'dlDelete', p_xnxq: SEM, page: '',
      'p_del_id': SEM + ';' + code + ';' + seq + ';',
    });
    if (!res.submitted) return res;
    const gone = () => NX.fetchCandidateCourses().then(newCand =>
      !newCand.some(s => s.code === code && String(s.seq) === String(seq)));
    if (await NX.pollUntil(gone, 500, 3)) return { ok: true, msg: '已退出候补队列' };
    return { ok: false, msg: '退出队列未生效，请稍后重试' };
  }
  // 已选课程：m=deleteYxk
  const searchUrl = BASE + '/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=' + SEM + '&tokenPriFlag=yx';
  const res = await fetchFormSubmit(searchUrl, {
    m: 'deleteYxk', p_xnxq: SEM, page: '',
    tokenPriFlag: 'yx', tk: '', jhzy_kch: '', jhzy_kxh: '', jhzy_zy: '',
    'p_del_id': SEM + ';' + code + ';' + seq + ';',
  });
  if (!res.submitted) return res;
  const gone = () => fetchSelectedCourses().then(sel =>
    !sel.some(s => s.code === code && String(s.seq) === String(seq)));
  if (await NX.pollUntil(gone, 500, 3)) return { ok: true, msg: '退选成功' };
  return { ok: false, msg: '退选未生效，请稍后重试' };
};

NX.changeVolunteer = async function (code, seq, targetZy) {
  const { state, fetchFormSubmit } = NX;
  const { SEM, BASE } = state;
  const searchUrl = BASE + '/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=' + SEM + '&tokenPriFlag=yx';
  const res = await fetchFormSubmit(searchUrl, {
    m: 'changeZY', p_xnxq: SEM, tokenPriFlag: 'yx', page: '',
    tk: '', jhzy_kch: code, jhzy_kxh: seq, jhzy_zy: String(targetZy),
  });
  if (!res.submitted) return { ok: false, msg: '志愿调整提交失败' };
  await new Promise(r => setTimeout(r, 1000));
  return { ok: true, msg: '志愿已调整为第' + targetZy + '志愿' };
};

NX.fetchSelectedCourses = async function () {
  const { state, fetchPage } = NX;
  if (!state.isZhjwxk) return [];
  const { SEM, BASE } = state;
  try {
    const _t = Date.now();
    const html = await fetchPage(BASE + '/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=' + SEM + '&tokenPriFlag=yx&_t=' + _t);
    const doc = new DOMParser().parseFromString(html, 'text/html');
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
      const cell2 = cell(2) || '';
      const zyFromCell = cell2.match(/第([一二三])志愿/);
      const isSportsCourse = !cell(1) && zyFromCell;
      const zyNum = zyInfo.zy || (zyFromCell ? ({ '一': 1, '二': 2, '三': 3 }[zyFromCell[1]]) : 0);
      const typeLabel = isSportsCourse ? '体育' : (cell(1) || zyInfo.typeLabel || '');
      selected.push({
        code, seq, name: cell(3) || cell(1), teacher: cell(7) || cell(2),
        time: cell(6) || cell(3), credits: parseFloat(cell(8) || cell(4)) || 0,
        typeLabel,
        zy: zyNum,
        typeCode: isSportsCourse ? 'ty' : (zyInfo.typeCode || ''),
      });
    });
    console.log(NX.TAG, 'selected courses:', selected.length);
    return selected;
  } catch (e) { console.warn(NX.TAG, 'fetch selected:', e); return []; }
};

NX.fetchLevelTable = async function () {
  const { state, fetchPage } = NX;
  if (!state.isZhjwxk) return {};
  const { SEM, BASE } = state;
  try {
    const url = BASE + '/xkBks.vxkBksXkbBs.do?p_xnxq=' + SEM + '&pathContent=' + encodeURIComponent('一级课表');
    const html = await fetchPage(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tr.trr2');
    const map = {};
    rows.forEach(row => {
      const rawCells = [...row.querySelectorAll('td')].map(td => td.textContent.trim().replace(/\s+/g, ' '));
      let code = '', seq = '', attr = '';
      for (let i = 0; i < rawCells.length; i++) {
        if (/^\d{8}$/.test(rawCells[i]) && !code) {
          code = rawCells[i]; seq = rawCells[i + 1] || '0';
          attr = rawCells[i + 2] || '';
          if (!/^(必修|限选|任选)$/.test(attr)) attr = '';
        }
      }
      if (!code) return;
      const isSports = !attr;
      const typeLabel = isSports ? '体育' : attr;
      const typeCode = isSports ? 'ty' : attr === '必修' ? '006' : attr === '限选' ? '008' : attr === '任选' ? '007' : '';
      map[code + '_' + seq] = { typeCode, typeLabel, attr };
    });
    console.log(NX.TAG, 'level table:', Object.keys(map).length, 'courses');
    return map;
  } catch (e) { console.warn(NX.TAG, 'level table:', e); return {}; }
};

NX.fetchCourseDetail = async function (teacherId, code) {
  const { state, fetchPage } = NX;
  if (!state.isZhjwxk) return null;
  const url = state.BASE + '/js.vjsKcbBs.do?m=showToXs&p_id=' + encodeURIComponent(teacherId + ';' + code);
  try {
    const html = await fetchPage(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('form table table.table-striped') || doc.querySelector('form table.table-striped') || doc.querySelector('table.table-striped');
    if (!table) return null;
    const rows = table.querySelectorAll('tr');
    const fields = {};
    const skipLabels = new Set(['课程名', '课程号']);
    rows.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) return;
      const l1 = tds[0]?.textContent?.trim().replace(/：/g, '') || '';
      const v1 = tds[1]?.textContent?.trim() || '';
      if (l1 && v1 && l1.length < 20 && !/^\d+$/.test(l1) && !skipLabels.has(l1)) fields[l1] = v1;
      if (tds.length >= 4) {
        const l2 = tds[2]?.textContent?.trim().replace(/：/g, '') || '';
        const v2 = tds[3]?.textContent?.trim() || '';
        if (l2 && v2 && l2.length < 20 && !/^\d+$/.test(l2) && !skipLabels.has(l2)) fields[l2] = v2;
      }
    });
    return fields;
  } catch (e) { console.warn(NX.TAG, 'detail fetch:', e); return null; }
};

// ─── Queue Data (课余量 + 排队人数) ──────────────────────────

NX.fetchQueueData = async function () {
  const { state, fetchPage } = NX;
  if (!state.isZhjwxk) return { map: {}, phase: false };
  const { SEM, BASE } = state;
  try {
    const map = {};
    const firstHtml = await fetchPage(BASE + '/xkBks.vxkBksXkbBs.do?m=xkqkSearch&p_xnxq=' + SEM);
    if (!firstHtml.includes('gridData') || firstHtml.includes('accessDenied')) return { map: {}, phase: false };
    const gridRegex = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*\]/g;
    let gm;
    while ((gm = gridRegex.exec(firstHtml)) !== null) {
      const key = gm[1] + '_' + gm[2];
      map[key] = { code: gm[1], seq: gm[2], qCapacity: parseInt(gm[3]) || 0, qRemaining: parseInt(gm[4]) || 0, qQueue: 0 };
    }
    const tokenMatch = firstHtml.match(/name="token"\s+value="([^"]+)"/);
    const token = tokenMatch ? tokenMatch[1] : '';
    const formAction = BASE + '/xkBks.vxkBksJxjhBs.do';
    const pgRegex = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*\]/g;
    if (token) {
      const gPager = NX.parsePagerInfo(firstHtml);
      const parseKyl = html => {
        if (!html.includes('gridData')) return { items: [], hasData: false };
        const items = [];
        let pm;
        while ((pm = pgRegex.exec(html)) !== null) {
          items.push({ code: pm[1], seq: pm[2], qCapacity: parseInt(pm[3]) || 0, qRemaining: parseInt(pm[4]) || 0, qQueue: 0 });
        }
        return { items, hasData: items.length > 0 };
      };
      // v1.3.11：完整表单 POST（UI 同款字段）+ 课号前缀分批
      //（kylSearch 表单无院系字段，仅支持课号/课序/课名过滤；深翻页同样会被限制）
      const kylPost = async (p, kch) => {
        const body = new URLSearchParams({
          m: 'kylSearch', page: String(p), token,
          'p_sort.p1': '', 'p_sort.p2': '', 'p_sort.asc1': 'true', 'p_sort.asc2': 'true',
          p_xnxq: SEM, pathContent: '',
          p_kch: kch || '', p_kxh: '', p_kcm: '', p_skxq: '', p_skjc: '', bt: '',
        });
        const resp = await fetch(formAction, { method: 'POST', credentials: 'include', body });
        const buf = await resp.arrayBuffer();
        return new TextDecoder('gbk').decode(buf);
      };
      const addToMap = list => list.forEach(q => { const key = q.code + '_' + q.seq; if (!map[key]) map[key] = q; });
      const grabKyl = async kch => {
        let fh = '';
        try { fh = await kylPost(0, kch); }
        catch (e) { return { items: [], pages: 0 }; }
        const dp = NX.parsePagerInfo(fh);
        const items = await NX.pagedFetch({
          firstHtml: fh,
          fetchPage: p => kylPost(p, kch),
          parse: parseKyl,
          maxPages: 100, concurrency: 1, throttle: 30,
          dedupe: q => q.code + '_' + q.seq,
          expectPages: dp.pages, label: 'kyl' + (kch ? '/' + kch : ''),
        });
        return { items, pages: dp.pages };
      };
      // 课号前 2 位分组（来自已抓好的课程目录）
      const prefixes = [...new Set((NX.state.allCourses || []).map(c => String(c.code).slice(0, 2)).filter(x => /^\d{2}$/.test(x)))];
      let split = false;
      if (prefixes.length > 3 && gPager.pages > 12) {
        const probe = await grabKyl(prefixes[0]);
        if (probe.pages > 0 && probe.pages < gPager.pages) {
          split = true;
          console.log(NX.TAG, 'kyl kch-split engaged:', prefixes.length, 'prefixes, probe', prefixes[0], 'has', probe.pages, 'pages vs global', gPager.pages);
          addToMap(probe.items);
          let kylIncomplete = 0;
          await NX.runPool(prefixes.slice(1), 4, async pf => {
            try { addToMap((await grabKyl(pf)).items); }
            catch (e) { kylIncomplete++; console.warn(NX.TAG, 'kyl prefix', pf, e); }
          });
          if (kylIncomplete > 0 && !NX.state.fetchWarn) NX.state.fetchWarn = '⚠ 课余量有 ' + kylIncomplete + ' 个课号段可能不完整（详见 Console）';
        }
      }
      if (!split) {
        if (prefixes.length > 3) console.warn(NX.TAG, 'kylSearch p_kch split ineffective, whole-query');
        const items = await NX.pagedFetch({
          firstHtml, fetchPage: p => kylPost(p, ''), parse: parseKyl,
          maxPages: 320, concurrency: 1, throttle: 50,
          dedupe: q => q.code + '_' + q.seq,
          expectPages: gPager.pages, label: 'kylSearch',
        });
        addToMap(items);
      }
    }
    if (!Object.keys(map).length) return { map: {}, phase: false };
    // Fetch real-time queue counts（并发 4，原为逐批串行）
    const parts = Object.values(map).map(q => SEM + '_' + q.code + '_' + q.seq);
    const batchSize = 100;
    const batches = [];
    for (let i = 0; i < parts.length; i += batchSize) batches.push(parts.slice(i, i + batchSize));
    await NX.runPool(batches, 4, async kcMsg => {
      try {
        const qResp = await fetch(BASE + '/xkBks.vxkBksXkbBs.do?m=selectBksDlCount&kc_message=' + encodeURIComponent(kcMsg.join(';')), {
          credentials: 'include',
        });
        if (!qResp.ok) return;
        const qBuf = await qResp.arrayBuffer();
        const qText = new TextDecoder('gbk').decode(qBuf);
        const qData = JSON.parse(qText);
        if (Array.isArray(qData)) {
          qData.forEach(obj => {
            const key = obj.kch + '_' + obj.kxh;
            if (map[key]) map[key].qQueue = parseInt(obj.dlrs) || 0;
          });
        }
      } catch (e) { console.warn(NX.TAG, 'queue count batch:', e); }
    });
    console.log(NX.TAG, 'queue data:', Object.keys(map).length, 'courses');
    return { map, phase: true };
  } catch (e) {
    console.warn(NX.TAG, 'queue data fetch:', e);
    return { map: {}, phase: false };
  }
};

// ─── Candidate Courses (候补队列) ─────────────────────────────

NX.fetchCandidateCourses = async function () {
  const { state, fetchPage } = NX;
  if (!state.isZhjwxk) return [];
  const { SEM, BASE } = state;
  try {
    const html = await fetchPage(BASE + '/xkBks.vxkBksXkbBs.do?m=dlSearch&p_xnxq=' + SEM);
    if (html.includes('accessDenied') || !html.includes('trr2')) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tr.trr2');
    const candidates = [];
    rows.forEach(row => {
      const tds = row.querySelectorAll('td');
      if (tds.length < 9) return;
      const cell = i => (tds[i]?.textContent || '').trim().replace(/\s+/g, ' ');
      const typeLabel = cell(0);
      const zyStr = cell(1);
      const code = cell(2);
      const name = cell(3);
      const seq = cell(4);
      const queueTotal = parseInt(cell(5)) || 0;
      const myPos = parseInt(cell(6)) || 0;
      const time = cell(7);
      const teacher = cell(8);
      const zyNum = zyStr.match(/第([一二三])志愿/);
      const typeCode = typeLabel === '必修' ? '006' : typeLabel === '限选' ? '008' : '007';
      candidates.push({
        code, seq: seq || '0', name, teacher, time,
        credits: 0, typeLabel, typeCode,
        zy: zyNum ? ({ '一': 1, '二': 2, '三': 3 }[zyNum[1]] || 3) : 3,
        queueTotal, myPos,
        isCandidate: true,
        selected: false,
      });
    });
    console.log(NX.TAG, 'candidate courses:', candidates.length);
    return candidates;
  } catch (e) {
    console.warn(NX.TAG, 'candidate fetch:', e);
    return [];
  }
};

// ─── Merge ────────────────────────────────────────────────────

NX.mergeStaticData = function (catalog, volData, plan) {
  const { baseFlag } = NX;
  const courses = catalog.length ? catalog : plan.map(c => ({ ...c, available: true, teacher: '', time: '', capacity: '', selected: false, queue: '' }));
  if (Object.keys(volData).length) {
    // 预建 code 索引：原实现每门课 Object.values().find() 线性扫，6000 课 × 数千志愿 = O(n²) 卡死主线程
    const byCode = {};
    for (const v of Object.values(volData)) {
      if (!byCode[v.code]) byCode[v.code] = v;
    }
    courses.forEach(c => {
      const v = (c.seq && volData[c.code + '_' + c.seq]) || byCode[c.code];
      if (v) {
        c.volRequired = v.volRequired; c.volElective = v.volElective; c.volOptional = v.volOptional;
        c.volSports = v.volSports || '';
        c.volCapacity = v.capacity || c.capacity; c.volApplied = v.applied || 0;
        if ((c.attr === '体育' || c.department?.includes('体育') || c.name?.includes('体育')) && v.volSports) {
          c.volApplied = v.applied || 0;
          c.volCapacity = v.capacity || c.volCapacity;
        }
      } else if ('volRequired' in c || 'volApplied' in c) {
        // re-merge 场景（输入为缓存 courses）：志愿已撤下的课清掉旧值，避免展示过期数据
        c.volRequired = ''; c.volElective = ''; c.volOptional = ''; c.volSports = '';
        c.volApplied = 0; c.volCapacity = 0;
      }
    });
  }
  if (plan.length) {
    const pm = {}; plan.forEach(p => { pm[p.code] = p.attr; });
    courses.forEach(c => { if (!c.attr && pm[c.code]) c.attr = pm[c.code]; });
  }
  return courses;
};
