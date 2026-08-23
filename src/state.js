// ═══════════════════════════════════════════════════════════════
// NextTHUxk — State: 课表解析、冲突检测、暂存/草稿管理、选课状态
// ═══════════════════════════════════════════════════════════════
var NX = NX || {};

// ─── Timetable Parsing ────────────────────────────────────────

NX.parseTimeSlots = function (timeStr) {
  if (!timeStr) return [];
  // 缓存：全校时间串种类有限（几百个），避免每次筛选/渲染重复正则解析
  if (!NX._slotsCache) NX._slotsCache = new Map();
  const hit = NX._slotsCache.get(timeStr);
  if (hit) return hit;
  const slots = [];
  const dayLabels = ['周一','周二','周三','周四','周五','周六','周日'];
  const slotLabels = ['1-2节','3-4节','5-6节','7-8节','9-10节','11-12节'];
  const re = /(\d+)\s*[-–—]\s*(\d+)\s*\([^)]*\)/g;
  let m;
  while ((m = re.exec(timeStr)) !== null) {
    const dayNum = parseInt(m[1]);
    const dajie = parseInt(m[2]);
    if (dayNum >= 1 && dayNum <= 7 && dajie >= 1 && dajie <= 6) {
      slots.push({ day: dayLabels[dayNum - 1], slot: slotLabels[dajie - 1] });
    }
  }
  NX._slotsCache.set(timeStr, slots);
  return slots;
};

NX.detectConflicts = function (courses) {
  const slotMap = {};
  const conflicts = [];
  courses.forEach(c => {
    NX.parseTimeSlots(c.time).forEach(({ day, slot }) => {
      const k = day + '|' + slot;
      if (slotMap[k]) conflicts.push({ day, slot, a: slotMap[k], b: c.name });
      else slotMap[k] = c.name;
    });
  });
  return conflicts;
};

// 当前预览课表（selected/stage/draft 三态），多处复用
NX.getPreviewCourses = function () {
  const { allCourses, stageCart, savedDrafts, previewMode, previewDraftIdx } = NX.state;
  if (previewMode === 'selected') {
    // selected 集合只在 resolveCourseZy 后变化，用版本号稳定引用（否则每次 filter 出新数组，索引缓存永不命中）
    const v = NX.state.selVersion || 0;
    if (NX._selCacheV !== v) { NX._selCache = allCourses.filter(c => c.selected); NX._selCacheV = v; }
    return NX._selCache;
  }
  if (previewMode === 'stage') return stageCart;
  if (previewMode === 'draft' && previewDraftIdx >= 0 && savedDrafts[previewDraftIdx]) return savedDrafts[previewDraftIdx].courses;
  return [];
};

// 预览课表槽位索引（引用+长度双重失效）：slotKey → [占用课程列表]
NX._pvRef = null; NX._pvLen = -1; NX._pvIdx = null;
NX.invalidatePreview = function () { NX._pvRef = null; NX._pvLen = -1; NX._pvIdx = null; };
NX.previewSlotIndex = function () {
  const previewCourses = NX.getPreviewCourses();
  if (NX._pvRef !== previewCourses || NX._pvLen !== previewCourses.length) {
    const idx = new Map();
    previewCourses.forEach(pc => {
      NX.parseTimeSlots(pc.time || '').forEach(({ day, slot }) => {
        const k = day + '|' + slot;
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push({ name: pc.name || pc.code, code: pc.code, seq: String(pc.seq || '0') });
      });
    });
    NX._pvRef = previewCourses;
    NX._pvLen = previewCourses.length;
    NX._pvIdx = idx;
  }
  return NX._pvIdx;
};

NX.findPreviewConflicts = function (course) {
  const idx = NX.previewSlotIndex();
  if (!idx.size) return [];
  const selfSeq = String(course.seq || '0');
  const conflicts = [];
  const seen = new Set();
  for (const { day, slot } of NX.parseTimeSlots(course.time || '')) {
    const hits = idx.get(day + '|' + slot);
    if (!hits) continue;
    for (const h of hits) {
      if (h.code === course.code && h.seq === selfSeq) continue;
      const k = h.name + '|' + day + '|' + slot;
      if (seen.has(k)) continue;
      seen.add(k);
      conflicts.push({ name: h.name, day, slot });
    }
  }
  return conflicts;
};

// ─── Toast ────────────────────────────────────────────────────

NX.showXkResult = function (res) {
  const $ = NX.state.$;
  let toast = $('nextthuxk-toast');
  if (!toast) return;
  toast.className = res.ok ? 'nx-toast nx-toast-ok' : 'nx-toast nx-toast-err';
  toast.textContent = (res.ok ? '✓ ' : '✗ ') + (res.msg || (res.ok ? '操作成功' : '操作失败'));
  toast.style.display = 'block';
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.style.display = 'none', 300); }, 2500);
};

// ─── Volunteer Confirmation Modal ─────────────────────────────

NX.showZyModal = function (missingZy) {
  const { esc, state, courseFlag } = NX;
  const $ = state.$;
  return new Promise(resolve => {
    const mask = $('nextthuxk-zy-modal');
    const body = $('nextthuxk-zy-modal-body');
    if (!mask || !body) { resolve(missingZy.map(() => 3)); return; }
    body.innerHTML = '<div class="nx-zy-hint">以下课程未能自动获取志愿信息，请手动确认：</div>' + missingZy.map((c, i) => {
      const flag = courseFlag(c) === 'ty' ? '体育' : c.typeLabel || '?';
      const curZy = c.zy || 3;
      return '<div class="nx-zy-row">' +
        '<span class="nx-zy-name">' + esc(c.name) + '</span>' +
        '<span class="nx-zy-type">' + esc(flag) + '</span>' +
        '<select class="nx-zy-select nx-zy-modal-sel" data-idx="' + i + '">' +
        '<option value="1"' + (curZy === 1 ? ' selected' : '') + '>第1志愿</option>' +
        '<option value="2"' + (curZy === 2 ? ' selected' : '') + '>第2志愿</option>' +
        '<option value="3"' + (curZy === 3 ? ' selected' : '') + '>第3志愿</option>' +
        '</select></div>';
    }).join('');
    mask.classList.add('show');
    const finish = () => {
      mask.classList.remove('show');
      const values = [];
      body.querySelectorAll('.nx-zy-modal-sel').forEach(sel => values.push(parseInt(sel.value) || 3));
      resolve(values);
    };
    $('nextthuxk-zy-modal-ok').onclick = finish;
    $('nextthuxk-zy-modal-close').onclick = finish;
  });
};

// ─── Resolve Course ZY (志愿信息) ─────────────────────────────

NX.resolveCourseZy = async function (courses, selMap, zyCache) {
  const { state, store, fetchLevelTable, showZyModal } = NX;
  const { isQueuePhase } = state;
  let cacheUpdated = false;
  const missingZy = [];
  let levelMap = null;
  let selectedChanged = false;
  for (const c of courses) {
    const key = c.code + '_' + (c.seq || '0');
    const s = selMap[key];
    if (c.selected !== !!s) selectedChanged = true;
    c.selected = !!s;
    if (s) {
      if (s.zy > 0) {
        c.zy = s.zy; c.typeCode = s.typeCode; c.typeLabel = s.typeLabel;
        zyCache[key] = { zy: s.zy, typeCode: s.typeCode, typeLabel: s.typeLabel, confirmed: true };
        cacheUpdated = true;
      } else {
        const cached = zyCache[key];
        if (cached && cached.zy > 0 && cached.confirmed) {
          c.zy = cached.zy; c.typeCode = cached.typeCode; c.typeLabel = cached.typeLabel;
        } else {
          if (!levelMap) levelMap = await fetchLevelTable();
          const lt = levelMap[key];
          if (lt) { c.typeCode = lt.typeCode; c.typeLabel = lt.typeLabel; }
          else { c.typeCode = s.typeCode; c.typeLabel = s.typeLabel; }
          c.zy = (cached && cached.zy > 0) ? cached.zy : 0;
          missingZy.push(c);
        }
      }
    } else {
      c.zy = 0; c.typeCode = ''; c.typeLabel = '';
    }
  }
  if (missingZy.length) {
    if (isQueuePhase) {
      missingZy.forEach(c => {
        c.zy = 3;
        zyCache[c.code + '_' + (c.seq || '0')] = { zy: 3, typeCode: c.typeCode, typeLabel: c.typeLabel, confirmed: false };
      });
      cacheUpdated = true;
      if (selectedChanged) NX.state.selVersion = (NX.state.selVersion || 0) + 1;
      return cacheUpdated;
    }
    const values = await showZyModal(missingZy);
    missingZy.forEach((c, i) => {
      if (values[i] > 0) {
        c.zy = values[i];
        zyCache[c.code + '_' + (c.seq || '0')] = { zy: c.zy, typeCode: c.typeCode, typeLabel: c.typeLabel, confirmed: false };
        cacheUpdated = true;
      }
    });
  }
  if (selectedChanged) NX.state.selVersion = (NX.state.selVersion || 0) + 1;
  return cacheUpdated;
};

NX.refreshSelected = async function () {
  const { state, store, fetchSelectedCourses, fetchCandidateCourses, resolveCourseZy, filterCourses, renderPreviewTT } = NX;
  const { allCourses } = state;
  // 重新获取已选课程
  const selected = await fetchSelectedCourses();
  const selMap = {};
  selected.forEach(s => { selMap[s.code + '_' + s.seq] = s; });
  const zyCache = (await store.get('zyCache')) || {};
  const cacheUpdated = await resolveCourseZy(allCourses, selMap, zyCache);
  if (cacheUpdated) await store.set('zyCache', zyCache);
  // 重新获取候补队列（排队选课后状态会变化）
  try {
    state.candidateCourses = await fetchCandidateCourses();
  } catch (e) { /* 保持现有候补数据不变 */ }
  // 同步 isCandidate 标记
  const candKeys = new Set(state.candidateCourses.map(c => c.code + '_' + c.seq));
  allCourses.forEach(c => {
    c.isCandidate = candKeys.has(c.code + '_' + (c.seq || '0'));
  });
  filterCourses();
  renderPreviewTT(
    allCourses.filter(c => c.selected).concat(state.candidateCourses.filter(cc => !allCourses.some(ac => ac.selected && ac.code === cc.code))),
    '当前已选'
  );
};

// ─── Stage Cart & Drafts ──────────────────────────────────────

NX.addToStage = function (code, seq, flag, zy) {
  const { state, store, showXkResult, baseFlag, renderStageCart, filterCourses } = NX;
  const { allCourses, stageCart } = state;
  const c = allCourses.find(x => x.code === code && String(x.seq || '0') === String(seq || '0'));
  if (!c) return;
  if (stageCart.some(s => s.code === code && String(s.seq) === String(seq || '0'))) {
    showXkResult({ ok: false, msg: '该课程已在暂存区' }); return;
  }
  stageCart.push({
    code: c.code, seq: c.seq || '0', name: c.name, teacher: c.teacher || '',
    time: c.time || '', credits: c.credits || 0, flag, zy: parseInt(zy) || 3,
    baseFlag: baseFlag(c),
  });
  renderStageCart();
  store.set('stageCart', stageCart);
  showXkResult({ ok: true, msg: '已暂存「' + c.name + '」' });
};

NX.removeFromStage = function (idx) {
  const { state, store, renderStageCart, filterCourses, invalidatePreview } = NX;
  state.stageCart.splice(idx, 1);
  NX.invalidatePreview();
  renderStageCart();
  store.set('stageCart', state.stageCart);
  filterCourses();
};

NX.askReplaceDraft = function (name, courses) {
  const { state, store, showXkResult, renderDrafts } = NX;
  const { savedDrafts } = state;
  if (savedDrafts.length < 5) {
    savedDrafts.push({ id: Date.now(), name, courses: [...courses], createdAt: Date.now() });
    renderDrafts(); store.set('drafts', savedDrafts);
    return true;
  }
  const list = savedDrafts.map((d, i) => (i + 1) + '. ' + d.name + ' (' + d.courses.length + '门·' + d.courses.reduce((s, c) => s + (c.credits || 0), 0) + '学分)').join('\n');
  const choice = prompt('草稿已满(5/5)，输入要替换的编号(1-5)，取消则不保存：\n' + list);
  if (!choice) return false;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= 5) { showXkResult({ ok: false, msg: '已取消' }); return false; }
  savedDrafts[idx] = { id: Date.now(), name, courses: [...courses], createdAt: Date.now() };
  renderDrafts(); store.set('drafts', savedDrafts);
  return true;
};

NX.saveDraft = function () {
  const { state, store, showXkResult, askReplaceDraft, renderStageCart, filterCourses } = NX;
  const $ = state.$;
  const nameInput = $('nextthuxk-draft-name');
  const name = (nameInput?.value || '').trim() || '草稿' + (state.savedDrafts.length + 1);
  if (!state.stageCart.length) { showXkResult({ ok: false, msg: '暂存区没有课程' }); return; }
  if (askReplaceDraft(name, state.stageCart)) {
    state.stageCart = [];
    if (nameInput) nameInput.value = '';
    renderStageCart(); store.set('stageCart', state.stageCart);
    filterCourses();
    showXkResult({ ok: true, msg: '草稿「' + name + '」已保存' });
  }
};

NX.saveSelectedAsDraft = function () {
  const { state, showXkResult, askReplaceDraft } = NX;
  const { allCourses, stageCart } = state;
  const selected = allCourses.filter(c => c.selected);
  if (!selected.length) { showXkResult({ ok: false, msg: '没有已选课程' }); return; }
  const courses = selected.map(c => ({
    code: c.code, seq: c.seq || '0', name: c.name, teacher: c.teacher || '',
    time: c.time || '', credits: c.credits || 0,
    flag: c.typeCode === '006' ? 'bx' : c.typeCode === '008' ? 'xx' : c.typeCode === '007' ? 'rx' : 'bx',
    zy: c.zy || 3, baseFlag: NX.baseFlag(c),
  }));
  const d = new Date();
  const name = '已选课表 ' + (d.getMonth() + 1) + '/' + d.getDate();
  if (askReplaceDraft(name, courses)) {
    showXkResult({ ok: true, msg: '已选课程已保存为「' + name + '」' });
  }
};

NX.deleteDraft = function (idx) {
  const { state, store, renderDrafts } = NX;
  state.savedDrafts.splice(idx, 1);
  renderDrafts();
  store.set('drafts', state.savedDrafts);
};

NX.exportDraft = function (draft) {
  const { showXkResult } = NX;
  const data = {
    v: 1, name: draft.name,
    courses: draft.courses.map(c => ({
      code: c.code, seq: c.seq, name: c.name, teacher: c.teacher, time: c.time,
      credits: c.credits, flag: c.flag, zy: c.zy, baseFlag: c.baseFlag,
    })),
  };
  const json = JSON.stringify(data);
  navigator.clipboard.writeText(json).then(
    () => showXkResult({ ok: true, msg: '「' + draft.name + '」已复制到剪贴板，可分享给他人' }),
    () => {
      const ta = document.createElement('textarea');
      ta.value = json; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
      showXkResult({ ok: true, msg: '「' + draft.name + '」已复制到剪贴板' });
    }
  );
};

NX.exportStageCart = function () {
  const { state, exportDraft, showXkResult } = NX;
  if (!state.stageCart.length) { showXkResult({ ok: false, msg: '暂存区没有课程' }); return; }
  exportDraft({ name: '暂存课表', courses: state.stageCart });
};

NX.importToStage = function (jsonStr) {
  const { state, store, baseFlag, renderStageCart, showXkResult } = NX;
  const { allCourses, stageCart } = state;
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
    NX.invalidatePreview();
    renderStageCart();
    store.set('stageCart', stageCart);
    showXkResult({ ok: true, msg: '已导入 ' + added + ' 门课程到暂存区' });
  } catch (e) { showXkResult({ ok: false, msg: '导入失败: ' + e.message }); }
};

NX.promoteDraft = async function (draft) {
  const { state, showXkResult, fetchSelectedCourses, dropCourse, submitCourse, refreshSelected, renderPreviewTT } = NX;
  const $ = state.$;
  const toast = $('nextthuxk-toast');
  const prog = (msg) => { if (toast) { toast.className = 'nx-toast'; toast.style.cssText = 'display:block;opacity:1;background:rgba(29,31,36,.82);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);color:#fff'; toast.textContent = msg; } };
  try {
    prog('正在获取已选课程…');
    const current = await fetchSelectedCourses();
    for (let i = 0; i < current.length; i++) {
      prog('退选 ' + (i + 1) + '/' + current.length + ': ' + current[i].name);
      await dropCourse(current[i].code, current[i].seq);
      await new Promise(r => setTimeout(r, 1000));
    }
    for (let i = 0; i < draft.courses.length; i++) {
      const c = draft.courses[i];
      prog('选课 ' + (i + 1) + '/' + draft.courses.length + ': ' + c.name);
      await submitCourse(c.code, c.seq, c.zy || 3, c.flag || 'bx');
      // 排队选课内部已有 1.5s 延时，这里额外等 2s 避免触发验证码
      await new Promise(r => setTimeout(r, 2000));
    }
    await refreshSelected();
    showXkResult({ ok: true, msg: '课表「' + draft.name + '」已全部提交！' });
    const sel = state.allCourses.filter(c => c.selected);
    renderPreviewTT(sel, '当前已选');
  } catch (e) { showXkResult({ ok: false, msg: '提交出错: ' + e.message }); }
};

NX.canAdjustZy = function (code, seq, targetZy) {
  const { state, zyTypeOf, ZY_LIMITS } = NX;
  const { allCourses } = state;
  const course = allCourses.find(c => c.code === code && String(c.seq || '0') === String(seq || '0'));
  if (!course) return false;
  const zt = zyTypeOf(course);
  let count = 0;
  allCourses.forEach(c => {
    if (!c.selected) return;
    if (c.code === code && String(c.seq || '0') === String(seq || '0')) return;
    if (zyTypeOf(c) !== zt) return;
    if (c.zy === targetZy) count++;
  });
  const limits = ZY_LIMITS[zt] || ZY_LIMITS.bx;
  return count < (limits[targetZy - 1]?.[1] || 0);
};

// ─── Preview Remove Handler ───────────────────────────────────

NX.handlePreviewRemove = async function (code, seq) {
  const { state, dropCourse, showXkResult, removeFromStage, renderPreviewTT, renderDrafts } = NX;
  const { allCourses, stageCart, savedDrafts, previewMode, previewDraftIdx } = state;
  const $ = state.$;
  if (previewMode === 'selected') {
    const c = allCourses.find(x => x.code === code && String(x.seq || '0') === String(seq));
    const name = c?.name || code;
    if (!confirm('确认退选「' + name + '」？')) return;
    const res = await dropCourse(code, seq);
    showXkResult(res);
    // 增量刷新（原实现 NX.launch() 全量重启：重新拉目录/队列/渲染整个面板）
    if (res.ok) {
      await NX.refreshSelected();
      NX.renderPlan(state.planData);
    }
  } else if (previewMode === 'stage') {
    const idx = stageCart.findIndex(s => s.code === code && String(s.seq) === String(seq));
    const name = idx >= 0 ? stageCart[idx].name : code;
    if (!confirm('从暂存区移除「' + name + '」？')) return;
    removeFromStage(idx);
    renderPreviewTT(stageCart, $('nextthuxk-preview-info')?.textContent || '');
  } else if (previewMode === 'draft') {
    const draft = savedDrafts[previewDraftIdx];
    if (!draft) return;
    const idx = draft.courses.findIndex(s => s.code === code && String(s.seq) === String(seq));
    const name = idx >= 0 ? draft.courses[idx].name : code;
    if (!confirm('从草稿移除「' + name + '」？')) return;
    draft.courses.splice(idx, 1);
    NX.invalidatePreview();
    await NX.store.set('drafts', savedDrafts);
    renderDrafts();
    renderPreviewTT(draft.courses, '草稿「' + draft.name + '」预览');
  }
};
