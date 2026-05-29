// ═══════════════════════════════════════════════════════════════
// NextTHUxk — State: 课表解析、冲突检测、暂存/草稿管理、选课状态
// ═══════════════════════════════════════════════════════════════
var NX = NX || {};

// ─── Timetable Parsing ────────────────────────────────────────

NX.parseTimeSlots = function (timeStr) {
  if (!timeStr) return [];
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

NX.findPreviewConflicts = function (course) {
  const { state, parseTimeSlots } = NX;
  const { allCourses, stageCart, savedDrafts, previewMode, previewDraftIdx } = state;
  let previewCourses = [];
  if (previewMode === 'selected') {
    previewCourses = allCourses.filter(c => c.selected);
  } else if (previewMode === 'stage') {
    previewCourses = stageCart;
  } else if (previewMode === 'draft' && previewDraftIdx >= 0 && savedDrafts[previewDraftIdx]) {
    previewCourses = savedDrafts[previewDraftIdx].courses;
  }
  if (!previewCourses.length) return [];
  const slots = parseTimeSlots(course.time || '');
  if (!slots.length) return [];
  const conflicts = [];
  previewCourses.forEach(pc => {
    if (pc.code === course.code && String(pc.seq || '0') === String(course.seq || '0')) return;
    const pcSlots = parseTimeSlots(pc.time || '');
    slots.forEach(s => {
      pcSlots.forEach(ps => {
        if (s.day === ps.day && s.slot === ps.slot) {
          const name = pc.name || pc.code;
          if (!conflicts.some(c => c.name === name && c.day === s.day && c.slot === s.slot)) {
            conflicts.push({ name, day: s.day, slot: s.slot });
          }
        }
      });
    });
  });
  return conflicts;
};

// ─── Toast ────────────────────────────────────────────────────

NX.showXkResult = function (res) {
  const $ = NX.state.$;
  let toast = $('nextthuxk-toast');
  if (!toast) return;
  toast.className = res.ok ? 'nx-toast nx-toast-ok' : 'nx-toast nx-toast-err';
  toast.textContent = (res.ok ? '✅ ' : '❌ ') + (res.msg || (res.ok ? '操作成功' : '操作失败'));
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
  for (const c of courses) {
    const key = c.code + '_' + (c.seq || '0');
    const s = selMap[key];
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
  return cacheUpdated;
};

NX.refreshSelected = async function () {
  const { state, store, fetchSelectedCourses, resolveCourseZy, filterCourses, renderPreviewTT } = NX;
  const { allCourses, candidateCourses } = state;
  const selected = await fetchSelectedCourses();
  const selMap = {};
  selected.forEach(s => { selMap[s.code + '_' + s.seq] = s; });
  const zyCache = (await store.get('zyCache')) || {};
  const cacheUpdated = await resolveCourseZy(allCourses, selMap, zyCache);
  if (cacheUpdated) await store.set('zyCache', zyCache);
  filterCourses();
  renderPreviewTT(
    allCourses.filter(c => c.selected).concat(candidateCourses.filter(cc => !allCourses.some(ac => ac.selected && ac.code === cc.code))),
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
  const { state, store, renderStageCart, filterCourses } = NX;
  state.stageCart.splice(idx, 1);
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
    renderStageCart();
    store.set('stageCart', stageCart);
    showXkResult({ ok: true, msg: '已导入 ' + added + ' 门课程到暂存区' });
  } catch (e) { showXkResult({ ok: false, msg: '导入失败: ' + e.message }); }
};

NX.promoteDraft = async function (draft) {
  const { state, showXkResult, fetchSelectedCourses, dropCourse, submitCourse, refreshSelected, renderPreviewTT } = NX;
  const $ = state.$;
  const toast = $('nextthuxk-toast');
  const prog = (msg) => { if (toast) { toast.className = 'nx-toast'; toast.style.cssText = 'display:block;opacity:1;background:rgba(124,106,239,.95);color:#fff'; toast.textContent = msg; } };
  try {
    prog('⏳ 正在获取已选课程…');
    const current = await fetchSelectedCourses();
    for (let i = 0; i < current.length; i++) {
      prog('⏳ 退选 ' + (i + 1) + '/' + current.length + ': ' + current[i].name);
      await dropCourse(current[i].code, current[i].seq);
      await new Promise(r => setTimeout(r, 1000));
    }
    for (let i = 0; i < draft.courses.length; i++) {
      const c = draft.courses[i];
      prog('⏳ 选课 ' + (i + 1) + '/' + draft.courses.length + ': ' + c.name);
      await submitCourse(c.code, c.seq, c.zy || 3, c.flag || 'bx');
      await new Promise(r => setTimeout(r, 1500));
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
    if (res.ok) await NX.launch();
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
    await NX.store.set('drafts', savedDrafts);
    renderDrafts();
    renderPreviewTT(draft.courses, '草稿「' + draft.name + '」预览');
  }
};
