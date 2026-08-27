// ═══════════════════════════════════════════════════════════════
// NextTHUxk — Render: 所有渲染函数 + 筛选逻辑
// ═══════════════════════════════════════════════════════════════
var NX = NX || {};

// ─── THUbook 评分徽章（有数据才出现；按分数段分色便于扫读）──
// ≥4.5 神课绿 · 4.0~4.4 优质靛蓝 · 3.0~3.9 一般琥珀 · <3.0 避课红
NX.tbBadgeHtml = function (c) {
  const e = c._tbRef;
  if (!e || !e.count || !e.avg) return '';
  const a = Number(e.avg) || 0;
  const lv = a >= 4.5 ? 'lv-hi' : a >= 4 ? 'lv-good' : a >= 3 ? 'lv-mid' : 'lv-bad';
  return '<button type="button" class="nx-tb-badge ' + lv + '" data-code="' + NX.esc(c.code) + '" data-seq="' + NX.esc(c.seq || '0') + '" title="THU选课社区评分 · 点击查看全部点评">★' + a.toFixed(1) + '<i>' + e.count + '评</i></button>';
};

// ─── Course Card Rendering ────────────────────────────────────
// 渐进渲染：只渲染视口内+预载距离的卡片（原实现一次 innerHTML 全量 6000+ 卡，
// 数十万 DOM 节点 + 每按钮闭包，是内存占用巨大/卡顿的主因）
NX.RENDER_CHUNK = 80;

NX.courseCardHtml = function (c, ctx) {
  const { esc, state, volColor, fmtVol, baseFlag, allowedFlags, currentProbMeta, currentProbLine, fullProbGrid, typeCodeToFlag, findPreviewConflicts } = NX;
  const { queueDataMap, isQueuePhase } = state;
  const stageSet = ctx.stageSet;
    const tags = [];
    if (c.available) tags.push('<span class="nx-tag nx-tag-ok">可选</span>');
    else tags.push('<span class="nx-tag nx-tag-no">已满</span>');
    if (c.selected) tags.push('<span class="nx-tag nx-tag-sel">已选</span>');
    if (c.attr === '必修') tags.push('<span class="nx-tag nx-tag-req">必修</span>');
    else if (c.attr === '限选') tags.push('<span class="nx-tag nx-tag-ele">限选</span>');
    else if (c.attr === '任选') tags.push('<span class="nx-tag nx-tag-opt">任选</span>');
    if (c.teacher) tags.push('<span class="nx-tag">' + esc(c.teacher) + '</span>');
    if (c.time) tags.push('<span class="nx-tag">' + esc(c.time) + '</span>');
    if (c.department) tags.push('<span class="nx-tag">' + esc(c.department) + '</span>');
    const vc = volColor(c);
    const volParts = [];
    const isTy = c.attr === '体育' || c.department?.includes('体育') || c.name?.includes('体育') || c.typeLabel === '体育';
    if (isTy && c.volSports && c.volSports !== '0,0,0') {
      const s = fmtVol(c.volSports); if (s) volParts.push('<span>体 ' + s + '</span>');
    } else {
      if (c.volRequired && c.volRequired !== '0,0,0') { const s = fmtVol(c.volRequired); if (s) volParts.push('<span>必 ' + s + '</span>'); }
      if (c.volElective && c.volElective !== '0,0,0') { const s = fmtVol(c.volElective); if (s) volParts.push('<span>限 ' + s + '</span>'); }
      if (c.volOptional && c.volOptional !== '0,0,0') { const s = fmtVol(c.volOptional); if (s) volParts.push('<span>任 ' + s + '</span>'); }
    }
    const volHtml = volParts.length ? '<div class="nx-vol">' + volParts.join('') + '</div>' : '';
    const defFlag = baseFlag(c);
    const volApplied = c.volApplied || 0;
    const volCap = c.volCapacity || c.capacity || 0;
    const compLabel = vc.level === 'easy' ? '竞争宽松' : vc.level === 'medium' ? '竞争适中' : vc.level === 'hard' ? '竞争激烈' : '';
    const compHtml = volCap > 0 ? '<div class="nx-comp"><div class="nx-comp-bar" style="width:' + vc.pct + '%;background:' + vc.color + '"></div><span class="nx-comp-txt" style="color:' + vc.color + '">' + volApplied + '/' + volCap + ' · ' + compLabel + '</span></div>' : '';
    const currentFlag = c.selected ? typeCodeToFlag(c.typeCode) : defFlag;
    const currentZy = c.selected ? (c.zy || 3) : 3;
    const currentProbHtml = currentProbLine(c, currentFlag, currentZy);
    const probHtml = fullProbGrid(c, defFlag);
    const qKey = c.code + '_' + (c.seq || '0');
    const qd = queueDataMap[qKey];
    const cand = ctx.candMap.get(qKey);
    let queueInfoHtml = '';
    if (isQueuePhase && (qd || cand)) {
      if (cand) {
        queueInfoHtml = '<div style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
          '<span style="background:rgba(255,159,26,.12);color:#ff9f1a;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">排队第' + cand.myPos + '名</span>' +
          '<span style="background:rgba(154,161,172,.1);color:#9aa1ac;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">共' + cand.queueTotal + '人排队</span>' +
          (qd ? '<span style="background:rgba(' + (qd.qRemaining > 0 ? '52,199,89' : '255,59,48') + ',.12);color:' + (qd.qRemaining > 0 ? '#07c160' : '#ee4d4d') + ';padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">余' + qd.qRemaining + '/' + qd.qCapacity + '</span>' : '') +
          '<span style="font-size:10px;font-weight:700;color:#ff9f1a">' + cand.typeLabel + ' · 第' + cand.zy + '志愿</span></div>';
      } else if (qd) {
        const rc = qd.qRemaining > 0 ? '#07c160' : '#ee4d4d';
        const rl = qd.qRemaining > 0 ? '余' + qd.qRemaining + '/' + qd.qCapacity : '已满(容量' + qd.qCapacity + ')';
        const hope = qd.qRemaining > 0 ? '排入希望：高' : qd.qQueue > 0 ? '排入希望：低(队' + qd.qQueue + '人)' : '暂无排队';
        const hc = qd.qRemaining > 0 ? '#07c160' : qd.qQueue > 0 ? '#ff9f1a' : '#9aa1ac';
        queueInfoHtml = '<div style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
          '<span style="background:rgba(' + (qd.qRemaining > 0 ? '52,199,89' : '255,59,48') + ',.12);color:' + rc + ';padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">' + rl + '</span>' +
          (qd.qQueue > 0 ? '<span style="background:rgba(255,159,26,.12);color:#ff9f1a;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">排队 ' + qd.qQueue + '人</span>' : '') +
          '<span style="font-size:10px;font-weight:700;color:' + hc + '">' + hope + '</span></div>';
      }
    }
    const pConflicts = findPreviewConflicts(c);
    const conflictHtml = pConflicts.length
      ? '<div style="font-size:10px;color:#ee4d4d;margin-top:3px;display:flex;gap:4px;align-items:center;flex-wrap:wrap"><span>冲突:</span>' + pConflicts.slice(0, 3).map(cf => '<span style="background:rgba(238,77,77,.1);padding:1px 6px;border-radius:4px">' + cf.day + cf.slot + ' ' + esc(cf.name) + '</span>').join('') + '</div>'
      : '';
    const detail = [c.capacity ? '容量' + c.capacity : '', c.remaining !== undefined ? '余' + c.remaining : ''].filter(Boolean).join(' · ');
    const noteHtml = c.xkTextNote ? '<div style="font-size:11px;color:#ff9f1a;margin-top:4px;padding:3px 8px;background:rgba(255,159,26,.06);border-radius:4px;line-height:1.4">' + esc(c.xkTextNote) + '</div>' : '';
    let selectBtn;
    if (c.selected) {
      const volLabel = c.zy ? '<span class="nx-vol-info">第' + c.zy + '志愿 · ' + esc(c.typeLabel || '') + '</span>' : '';
      const p = currentProbMeta(c, currentFlag, currentZy);
      const probInline = isQueuePhase && (qd || cand)
        ? '<span class="nx-inline-prob" style="color:' + (cand ? '#ff9f1a' : qd.qRemaining > 0 ? '#07c160' : '#ee4d4d') + '">' + (cand ? '排队第' + cand.myPos + '名' : qd.qRemaining > 0 ? '余' + qd.qRemaining : '已满') + '</span>'
        : '<span class="nx-inline-prob nx-card-inline-prob" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '" style="color:' + p.color + '">' + (p.percentLabel || p.label) + '</span>';
      const canUp = c.zy && c.zy > 1 && NX.canAdjustZy(c.code, c.seq || '0', c.zy - 1);
      const canDown = c.zy && c.zy < 3 && NX.canAdjustZy(c.code, c.seq || '0', c.zy + 1);
      const upBtn = canUp ? '<button class="nx-vol-btn" data-dir="up" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '" data-zy="' + c.zy + '">▲</button>' : (c.zy > 1 ? '<button class="nx-vol-btn" disabled title="该志愿名额已满">▲</button>' : '');
      const downBtn = canDown ? '<button class="nx-vol-btn" data-dir="down" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '" data-zy="' + c.zy + '">▼</button>' : (c.zy < 3 ? '<button class="nx-vol-btn" disabled title="该志愿名额已满">▼</button>' : '');
      const sFlag = typeCodeToFlag(c.typeCode);
      const inStage = stageSet.has(c.code + '_' + String(c.seq || '0'));
      selectBtn = volLabel + probInline + upBtn + downBtn + '<button class="nx-stage-btn nx-add-stage-sel" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '" data-flag="' + sFlag + '" data-zy="' + (c.zy || 3) + '"' + (inStage ? ' disabled' : '') + '>' + (inStage ? '已暂存' : '暂存') + '</button><button class="nx-drop-btn" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '">退选</button>';
    } else if (c.available) {
      const inStage = stageSet.has(c.code + '_' + String(c.seq || '0'));
      const aFlags = allowedFlags(defFlag);
      const flagOpts = aFlags.map(f => '<option value="' + f + '"' + (defFlag === f ? ' selected' : '') + '>' + (f === 'bx' ? '必修' : f === 'xx' ? '限选' : f === 'rx' ? '任选' : '体育') + '</option>').join('');
      const p = currentProbMeta(c, currentFlag, currentZy);
      const probInline = isQueuePhase && (qd || cand)
        ? '<span class="nx-inline-prob" style="color:' + (cand ? '#ff9f1a' : qd.qRemaining > 0 ? '#07c160' : '#ee4d4d') + '">' + (cand ? '排队第' + cand.myPos + '名' : qd.qRemaining > 0 ? '余' + qd.qRemaining : '已满') + '</span>'
        : '<span class="nx-inline-prob nx-card-inline-prob" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '" style="color:' + p.color + '">' + (p.percentLabel || p.label) + '</span>';
      selectBtn = '<select class="nx-type-select" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '">' + flagOpts + '</select><select class="nx-zy-select" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '"><option value="3">3志愿</option><option value="2">2志愿</option><option value="1">1志愿</option></select>' + probInline + '<button class="nx-select-btn" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '">选课</button><button class="nx-stage-btn nx-add-stage" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '"' + (inStage ? ' disabled' : '') + '>' + (inStage ? '已暂存' : '暂存') + '</button>';
    } else if (c.isCandidate && cand) {
      // 已在候补队列中：显示排队位置 + 删除按钮
      selectBtn = '<span style="font-size:11px;color:#ff9f1a;font-weight:600">排队第' + cand.myPos + '名 / 共' + cand.queueTotal + '人</span>' +
        '<button class="nx-drop-btn" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '">删除</button>';
    } else {
      // 已满但未在队列：允许排队选课
      const inStage = stageSet.has(c.code + '_' + String(c.seq || '0'));
      const aFlags = allowedFlags(defFlag);
      const flagOpts = aFlags.map(f => '<option value="' + f + '"' + (defFlag === f ? ' selected' : '') + '>' + (f === 'bx' ? '必修' : f === 'xx' ? '限选' : f === 'rx' ? '任选' : '体育') + '</option>').join('');
      const p = currentProbMeta(c, currentFlag, currentZy);
      const probInline = isQueuePhase && (qd || cand)
        ? '<span class="nx-inline-prob" style="color:' + (cand ? '#ff9f1a' : qd.qRemaining > 0 ? '#07c160' : '#ee4d4d') + '">' + (cand ? '排队第' + cand.myPos + '名' : qd.qRemaining > 0 ? '余' + qd.qRemaining : '已满') + '</span>'
        : '<span class="nx-inline-prob nx-card-inline-prob" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '" style="color:' + p.color + '">' + (p.percentLabel || p.label) + '</span>';
      selectBtn = '<span style="font-size:10px;color:#ee4d4d;font-weight:600;margin-right:2px">已满</span>' +
        '<select class="nx-type-select" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '">' + flagOpts + '</select>' +
        '<select class="nx-zy-select" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '"><option value="3">3志愿</option><option value="2">2志愿</option><option value="1">1志愿</option></select>' +
        probInline +
        '<button class="nx-select-btn" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '" style="background:var(--nx-glass);color:var(--nx-ink-soft);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 0 0 1px var(--nx-line)">排队选课</button>' +
        '<button class="nx-stage-btn nx-add-stage" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '"' + (inStage ? ' disabled' : '') + '>' + (inStage ? '已暂存' : '暂存') + '</button>';
    }
    return '<div class="nx-card' + (c.selected ? ' nx-selected' : '') + '" data-code="' + esc(c.code) + '" data-seq="' + esc(c.seq || '0') + '" data-tid="' + esc(c.teacherId || '') + '">' +
      '<div class="nx-card-head"><span class="nx-card-name">' + esc(c.name) + '</span>' + NX.tbBadgeHtml(c) + '<span class="nx-card-credit">' + c.credits + '学分</span></div>' +
      '<div style="font-size:11px;color:#9aa1ac;margin-bottom:3px">' + esc(c.code) + (c.seq ? ' · ' + esc(c.seq) + '课序' : '') + '</div>' +
      '<div class="nx-tags">' + tags.join('') + '</div>' +
      (isQueuePhase && (qd || cand) ? queueInfoHtml : volHtml + compHtml + currentProbHtml + probHtml) + conflictHtml + noteHtml +
      '<div class="nx-card-detail"><div class="nx-card-detail-inner">' + detail + '</div></div>' +
      '<div class="nx-card-actions">' +
      '<button class="nx-detail-btn" data-code="' + esc(c.code) + '" data-tid="' + esc(c.teacherId || '') + '">简介</button>' +
      selectBtn + '</div></div>';
};

// ─── 渐进渲染 + 事件委托 ─────────────────────────────────────

// 通用课程查找（优先 Map 索引，回退线性扫）
NX.getCourse = function (code, seq) {
  const { courseMap, allCourses } = NX.state;
  const k = code + '_' + String(seq || '0');
  if (courseMap) { const hit = courseMap.get(k); if (hit) return hit; }
  return allCourses.find(x => x.code === code && String(x.seq || '0') === String(seq || '0'));
};

NX.rebuildCourseMap = function () {
  const m = new Map();
  for (const c of NX.state.allCourses) m.set(c.code + '_' + (c.seq || '0'), c);
  NX.state.courseMap = m;
};

NX.renderCourses = function (list) {
  const { state } = NX;
  const $ = state.$;
  const el = $('nextthuxk-list');
  if (!el) return;
  if (state.renderObserver) { state.renderObserver.disconnect(); state.renderObserver = null; }
  state.renderList = list;
  state.renderCursor = 0;
  if (!list.length) { el.innerHTML = '<div class="nx-empty">暂无匹配课程</div>'; return; }
  state.renderCtx = {
    candMap: new Map(state.candidateCourses.map(cc => [cc.code + '_' + String(cc.seq || '0'), cc])),
    stageSet: new Set(state.stageCart.map(s => s.code + '_' + String(s.seq || '0'))),
  };
  NX.bindCardDelegation(el);
  el.innerHTML = '';
  const sentinel = document.createElement('div');
  sentinel.className = 'nx-render-sentinel';
  el.appendChild(sentinel);
  state.renderSentinel = sentinel;
  NX.renderMoreCourses();
  const io = new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting)) NX.renderMoreCourses();
  }, { root: el, rootMargin: '800px' });
  io.observe(sentinel);
  state.renderObserver = io;
};

NX.renderMoreCourses = function () {
  const { state, courseCardHtml } = NX;
  const { renderList, renderCursor, renderSentinel, renderCtx, renderObserver } = state;
  if (!renderList || !renderSentinel) return;
  if (renderCursor >= renderList.length) { if (renderObserver) renderObserver.disconnect(); return; }
  const end = Math.min(renderCursor + NX.RENDER_CHUNK, renderList.length);
  const parts = [];
  for (let i = renderCursor; i < end; i++) parts.push(courseCardHtml(renderList[i], renderCtx));
  renderSentinel.insertAdjacentHTML('beforebegin', parts.join(''));
  state.renderCursor = end;
  if (end >= renderList.length && renderObserver) renderObserver.disconnect();
};

// 事件委托：容器级 click/change 两个监听器，替代每批 8 次 querySelectorAll + 每按钮闭包
NX.bindCardDelegation = function (el) {
  if (el.dataset.nxDelegated) return;
  el.dataset.nxDelegated = '1';
  const { showCourseModal, submitCourse, dropCourse, changeVolunteer, addToStage, refreshSelected, showXkResult, baseFlag } = NX;
  const { showReviewsModal } = NX;
  const syncCardProb = node => {
    const card = node.closest('.nx-card');
    if (!card) return;
    const course = NX.getCourse(card.dataset.code, node.dataset.seq);
    if (!course || course.selected) return;
    const flag = card.querySelector('.nx-type-select')?.value || baseFlag(course);
    const zy = parseInt(card.querySelector('.nx-zy-select')?.value) || 3;
    const meta = NX.currentProbMeta(course, flag, zy);
    const line = card.querySelector('.nx-current-prob');
    if (line) {
      line.dataset.flag = flag;
      line.dataset.zy = String(zy);
      const pill = line.querySelector('.nx-prob-pill');
      if (pill) {
        const detail = meta.ratioLabel && meta.ratioLabel !== '无数据' ? ' · ' + meta.ratioLabel : '';
        pill.textContent = meta.flagLabel + ' · ' + meta.zy + '志愿 · ' + (meta.percentLabel || meta.label) + detail;
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
  el.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) {
      const card = e.target.closest('.nx-card');
      if (card) card.classList.toggle('open');
      return;
    }
    const cls = btn.classList;
    if (cls.contains('nx-detail-btn')) {
      showCourseModal(btn.dataset.code, btn.dataset.tid);
    } else if (cls.contains('nx-tb-badge')) {
      if (showReviewsModal) showReviewsModal(btn.dataset.code, btn.dataset.seq);
      return;
    } else if (cls.contains('nx-select-btn')) {
      const actions = btn.parentElement;
      const flag = actions.querySelector('.nx-type-select')?.value || 'bx';
      const zy = actions.querySelector('.nx-zy-select')?.value || '3';
      const origText = btn.textContent;
      btn.disabled = true; btn.textContent = '提交中…';
      submitCourse(btn.dataset.code, btn.dataset.seq, parseInt(zy), flag)
        .then(res => { showXkResult(res); return res.ok ? refreshSelected() : null; })
        .catch(err => showXkResult({ ok: false, msg: err.message }))
        .finally(() => { btn.disabled = false; btn.textContent = origText; });
    } else if (cls.contains('nx-drop-btn')) {
      const origText = btn.textContent;
      btn.disabled = true; btn.textContent = origText.includes('删除') ? '退出中…' : '退选中…';
      dropCourse(btn.dataset.code, btn.dataset.seq)
        .then(res => { showXkResult(res); return res.ok ? refreshSelected() : null; })
        .catch(err => showXkResult({ ok: false, msg: err.message }))
        .finally(() => { btn.disabled = false; btn.textContent = origText; });
    } else if (cls.contains('nx-vol-btn')) {
      const curZy = parseInt(btn.dataset.zy) || 1;
      const targetZy = btn.dataset.dir === 'up' ? curZy - 1 : curZy + 1;
      if (targetZy < 1) return;
      btn.disabled = true;
      changeVolunteer(btn.dataset.code, btn.dataset.seq, targetZy)
        .then(res => { showXkResult(res); return res.ok ? refreshSelected() : null; })
        .catch(err => showXkResult({ ok: false, msg: err.message }))
        .finally(() => { btn.disabled = false; });
    } else if (cls.contains('nx-add-stage')) {
      const actions = btn.parentElement;
      const flag = actions.querySelector('.nx-type-select')?.value || 'bx';
      const zy = parseInt(actions.querySelector('.nx-zy-select')?.value) || 3;
      addToStage(btn.dataset.code, btn.dataset.seq, flag, zy);
      btn.textContent = '已暂存';
      btn.disabled = true;
    } else if (cls.contains('nx-add-stage-sel')) {
      addToStage(btn.dataset.code, btn.dataset.seq, btn.dataset.flag || 'bx', parseInt(btn.dataset.zy) || 3);
      btn.textContent = '已暂存';
      btn.disabled = true;
    }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.classList && (t.classList.contains('nx-type-select') || t.classList.contains('nx-zy-select'))) {
      syncCardProb(t);
    }
  });
};

// ─── Timetable Preview ────────────────────────────────────────

NX.renderPreviewTT = function (courses, label) {
  const { esc, state, typeCodeToFlag, calcProb, probBg, fullProbGrid, parseTimeSlots, handlePreviewRemove } = NX;
  const { allCourses, queueDataMap, isQueuePhase, candidateCourses, stageCart, savedDrafts, previewMode, previewDraftIdx } = state;
  const $ = state.$;
  const el = $('nextthuxk-preview-tt');
  const info = $('nextthuxk-preview-info');
  const resetBtn = $('nextthuxk-preview-reset');
  if (!el) return;
  if (info) info.textContent = label || '';
  if (resetBtn) resetBtn.style.display = (label && label !== '当前已选') ? 'inline-block' : 'none';
  state.previewMode = (label === '当前已选') ? 'selected' : 'stage';
  if (label && label.startsWith('草稿「')) state.previewMode = 'draft';
  if (!courses.length) { el.innerHTML = '<div class="nx-st">暂无课程</div>'; return; }
  const tt = {};
  const undet = [];   // 时间未定/无固定时段课程（#16）：不进网格，单列在表格下方
  courses.forEach((c, ci) => {
    const lbl = c.teacher ? c.name + '(' + c.teacher + ')' : c.name;
    let cellColor = '', probLabel = '', probBgColor = '';
    if (isQueuePhase) {
      const qKey = c.code + '_' + (c.seq || '0');
      const qd = queueDataMap[qKey];
      const cand = candidateCourses.find(cc => cc.code === c.code && String(cc.seq) === String(c.seq || '0'));
      if (c.isCandidate && cand) {
        cellColor = '#ff9f1a'; probLabel = '排队第' + cand.myPos + '/' + cand.queueTotal + '人'; probBgColor = 'rgba(255,159,26,.14)';
      } else if (state.previewMode === 'selected') {
        probLabel = '已选'; cellColor = '#07c160'; probBgColor = 'rgba(7,193,96,.14)';
      } else if (qd) {
        if (qd.qRemaining > 0) { cellColor = '#07c160'; probLabel = '余' + qd.qRemaining; probBgColor = 'rgba(7,193,96,.14)'; }
        else if (qd.qQueue > 0) { cellColor = '#ff9f1a'; probLabel = '排队' + qd.qQueue + '人'; probBgColor = 'rgba(255,159,26,.14)'; }
        else { cellColor = '#ee4d4d'; probLabel = '已满'; probBgColor = 'rgba(238,77,77,.14)'; }
      }
    } else if (state.previewMode === 'selected' && c.zy) {
      const sf = typeCodeToFlag(c.typeCode);
      const p = calcProb(c, sf, c.zy);
      if (p.prob >= 0) { cellColor = p.color; probLabel = p.percentLabel || p.label; probBgColor = probBg(p.color); }
    } else if ((state.previewMode === 'stage' || state.previewMode === 'draft') && c.flag && c.zy) {
      const ac = NX.getCourse(c.code, c.seq);
      if (ac) { const p = calcProb(ac, c.flag, c.zy); if (p.prob >= 0) { cellColor = p.color; probLabel = p.percentLabel || p.label; probBgColor = probBg(p.color); } }
    }
    const slots = parseTimeSlots(c.time);
    if (!slots.length) {
      // 时间未定/无固定时段（如二级选课阶段才定时间的实验课）→ 单列展示
      undet.push({ lbl, ci, code: c.code, seq: c.seq || '0', credits: c.credits || 0, zy: c.zy || 0 });
    }
    slots.forEach(({ day, slot }) => {
      if (!tt[day]) tt[day] = {};
      const entry = { label: lbl, ci, code: c.code, seq: c.seq || '0', color: cellColor, probLabel, probBgColor };
      if (tt[day][slot]) {
        const old = tt[day][slot];
        const existing = old.conflict ? old.items : [old];
        // Same course (code+seq) in same slot? Skip — split time range, not a conflict
        if (existing.some(e => e.code === entry.code && e.seq === entry.seq)) return;
        const labels = existing.concat(entry);
        tt[day][slot] = { label: labels.map(e => e.label).join(' / '), conflict: true, items: labels };
      } else tt[day][slot] = entry;
    });
  });
  const days = ['周一','周二','周三','周四','周五','周六','周日'];
  const sls = ['1-2节','3-4节','5-6节','7-8节','9-10节','11-12节'];
  let h = '<table class="nx-tt"><thead><tr><th></th>';
  days.forEach(d => h += '<th>' + d + '</th>');
  h += '</tr></thead><tbody>';
  sls.forEach(slot => {
    h += '<tr><th>' + slot + '</th>';
    days.forEach(day => {
      const val = tt[day]?.[slot];
      if (val) {
        const isC = val.conflict;
        const items = isC ? val.items : [val];
        const btns = items.map(it => '<span class="nx-tt-rm" data-code="' + esc(it.code) + '" data-seq="' + esc(it.seq) + '" title="移除 ' + esc(it.label) + '">✕</span>').join('');
        const linesHtml = items.map(it => {
          const probHtml = it.probLabel ? '<span class="nx-tt-prob" style="background:' + it.probBgColor + ';color:' + it.color + '">' + it.probLabel + '</span>' : '';
          return '<div class="nx-tt-line nx-tt-jump" data-code="' + esc(it.code) + '" data-seq="' + esc(it.seq) + '" title="在左侧课程列表中查看"><span class="nx-tt-text">' + esc(it.label) + '</span>' + probHtml + '</div>';
        }).join('');
        let cellClass = isC ? 'nx-c' : 'nx-s';
        let cellStyle = '';
        if (!isC && val.color) {
          const alpha = val.color === '#07c160' ? '.1' : val.color === '#ff9f1a' ? '.1' : '.1';
          cellStyle = 'background:' + val.color + (val.color.startsWith('rgba') ? '' : alpha) + ';color:' + val.color;
        }
        h += '<td class="' + cellClass + '" ' + (cellStyle ? 'style="' + cellStyle + '"' : '') + '><div class="nx-tt-cell">' + linesHtml + btns + '</div></td>';
      } else h += '<td></td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table>';
  // 时间未定课程单列（#16）
  if (undet.length) {
    h += '<div style="margin-top:10px;font-size:11px;color:var(--nx-faint)">时间未定 / 无固定时段（' + undet.length + ' 门，不含在上方网格中）</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' +
      undet.map(u => '<span class="nx-tt-undet" data-code="' + esc(u.code) + '" data-seq="' + esc(u.seq) + '" title="点击移除">' +
        esc(u.lbl) + ' · ' + u.credits + '学分' + (u.zy ? ' · 第' + u.zy + '志愿' : '') + ' <i>✕</i></span>').join('') +
      '</div>';
  }
  const cr = courses.reduce((s, c) => s + (c.credits || 0), 0);
  h += '<div class="nx-st ok" style="margin-top:6px">' + courses.length + '门课 · ' + cr + '学分</div>';
  el.innerHTML = h;
  el.querySelectorAll('.nx-tt-rm').forEach(btn => {
    btn.onclick = () => handlePreviewRemove(btn.dataset.code, btn.dataset.seq);
  });
  el.querySelectorAll('.nx-tt-jump').forEach(line => {
    line.onclick = () => NX.jumpToCourse(line.dataset.code, line.dataset.seq);
  });
  el.querySelectorAll('.nx-tt-undet').forEach(chip => {
    chip.onclick = () => handlePreviewRemove(chip.dataset.code, chip.dataset.seq);
  });
};

// 从课表预览定位到左侧课程列表。重置会隐藏目标课程的筛选条件，
// 用课程号搜索后精确滚动到对应课序号。
NX.jumpToCourse = function (code, seq) {
  const { state } = NX;
  const $ = state.$;
  const course = NX.getCourse(code, seq);
  const search = $('nextthuxk-search');
  const list = $('nextthuxk-list');
  if (!course || !search || !list) return;

  state.activeGroup = null;
  state.shadow.querySelectorAll('.nx-chip').forEach(chip => {
    chip.classList.toggle('on', chip.dataset.f === 'all');
  });
  [
    'nx-filter-credits', 'nx-filter-day', 'nx-filter-period',
    'nx-filter-conflict', 'nx-filter-reviews', 'nx-sort-by',
    'nx-filter-tongshi', 'nx-filter-feature', 'nx-filter-grade-filter',
    'nx-filter-bksrem', 'nx-filter-yjsrem'
  ].forEach(id => { const node = $(id); if (node) node.value = ''; });
  const note = $('nx-filter-xknote');
  if (note) note.value = '';

  search.value = course.code;
  NX.filterCourses();
  list.scrollTop = 0;

  requestAnimationFrame(() => {
    const target = [...list.querySelectorAll('.nx-card')].find(card =>
      card.dataset.code === String(code) &&
      String(card.dataset.seq || '0') === String(seq || '0')
    );
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('nx-jump-target');
    setTimeout(() => target.classList.remove('nx-jump-target'), 1800);
    search.focus({ preventScroll: true });
  });
};

// ─── Stage Cart Rendering ─────────────────────────────────────

NX.stageProbHtml = function (c) {
  const { state, fullProbGrid, baseFlag, getCourse } = NX;
  const { isQueuePhase, queueDataMap } = state;
  const ac = getCourse(c.code, c.seq);
  if (!ac) return '';
  if (isQueuePhase) {
    const qKey = c.code + '_' + (c.seq || '0');
    const qd = queueDataMap[qKey];
    if (qd) {
      const rc = qd.qRemaining > 0 ? '#07c160' : '#ee4d4d';
      return '<div style="margin-top:2px;display:flex;gap:4px;align-items:center;flex-wrap:wrap"><span style="background:rgba(' + (qd.qRemaining > 0 ? '52,199,89' : '255,59,48') + ',.12);color:' + rc + ';padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600">余' + qd.qRemaining + '/' + qd.qCapacity + '</span>' + (qd.qQueue > 0 ? '<span style="background:rgba(255,159,26,.12);color:#ff9f1a;padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600">排队' + qd.qQueue + '人</span>' : '') + '</div>';
    }
    return '';
  }
  const bf = c.baseFlag || baseFlag(ac);
  return fullProbGrid(ac, bf).replace(/margin-top:3px/, 'margin-top:2px');
};

NX.renderStageCart = function () {
  const { esc, state, store, baseFlag, allowedFlags, detectConflicts, renderPreviewTT } = NX;
  const { stageCart, allCourses } = state;
  const $ = state.$;
  const el = $('nextthuxk-stage-list');
  if (!el) return;
  if (!stageCart.length) { el.innerHTML = '<div class="nx-st">暂无暂存课程，点击课程卡片上的「暂存」按钮添加</div>'; $('nextthuxk-stage-conflict').innerHTML = ''; return; }
  el.innerHTML = stageCart.map((c, i) => {
    const bf = c.baseFlag || (() => { const ac = allCourses.find(x => x.code === c.code); return ac ? baseFlag(ac) : 'rx'; })();
    const aFlags = allowedFlags(bf);
    if (!aFlags.includes(c.flag)) { c.flag = aFlags[0]; store.set('stageCart', stageCart); }
    const flOpts = aFlags.map(f => '<option value="' + f + '"' + (c.flag === f ? ' selected' : '') + '>' + (f === 'bx' ? '必修' : f === 'xx' ? '限选' : f === 'rx' ? '任选' : '体育') + '</option>').join('');
    const zyOpts = [1, 2, 3].map(z => '<option value="' + z + '"' + (c.zy === z ? ' selected' : '') + '>' + z + '志愿</option>').join('');
    const prob = NX.stageProbHtml(c);
    return '<div class="nx-stage-item" style="flex-direction:column;align-items:stretch;gap:2px">' +
      '<div style="display:flex;align-items:center;gap:4px">' +
      '<span class="nx-stage-name" style="min-width:80px">' + esc(c.name) + (c.teacher ? ' <span style="color:#9aa1ac;font-weight:400">' + esc(c.teacher) + '</span>' : '') + '</span>' +
      '<span class="nx-stage-info">' + c.credits + '学分</span>' +
      '<select class="nx-stage-flag-sel" data-idx="' + i + '" style="padding:2px 4px;border-radius:6px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">' + flOpts + '</select>' +
      '<select class="nx-stage-zy-sel" data-idx="' + i + '" style="padding:2px 4px;border-radius:6px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">' + zyOpts + '</select>' +
      '<button class="nx-stage-rm" data-idx="' + i + '">✕</button></div>' + prob + '</div>';
  }).join('');
  el.querySelectorAll('.nx-stage-flag-sel').forEach(sel => {
    sel.onchange = () => {
      const i = parseInt(sel.dataset.idx);
      stageCart[i].flag = sel.value;
      store.set('stageCart', stageCart);
      NX.renderStageCart();
      if (state.previewMode === 'stage') renderPreviewTT(stageCart, $('nextthuxk-preview-info')?.textContent || '');
    };
  });
  el.querySelectorAll('.nx-stage-zy-sel').forEach(sel => {
    sel.onchange = () => {
      const i = parseInt(sel.dataset.idx);
      stageCart[i].zy = parseInt(sel.value);
      store.set('stageCart', stageCart);
      NX.renderStageCart();
      if (state.previewMode === 'stage') renderPreviewTT(stageCart, $('nextthuxk-preview-info')?.textContent || '');
    };
  });
  el.querySelectorAll('.nx-stage-rm').forEach(btn => {
    btn.onclick = () => NX.removeFromStage(parseInt(btn.dataset.idx));
  });
  const cf = $('nextthuxk-stage-conflict');
  if (cf) {
    const conflicts = detectConflicts(stageCart);
    if (conflicts.length) {
      cf.innerHTML = conflicts.map(c =>
        '<div style="font-size:11px;color:#ee4d4d">时间冲突：' + esc(c.day) + ' ' + esc(c.slot) + ' — ' + esc(c.a) + ' 与 ' + esc(c.b) + '</div>'
      ).join('');
    } else cf.innerHTML = '<div style="font-size:11px;color:#07c160">✓ 无时间冲突</div>';
  }
};

// ─── Drafts Rendering ─────────────────────────────────────────

NX.draftCourseProbHtml = function (c) {
  const { state, fullProbGrid, baseFlag, getCourse } = NX;
  const { isQueuePhase, queueDataMap } = state;
  const ac = getCourse(c.code, c.seq);
  if (!ac) return '';
  if (isQueuePhase) {
    const qKey = c.code + '_' + (c.seq || '0');
    const qd = queueDataMap[qKey];
    if (qd) {
      const rc = qd.qRemaining > 0 ? '#07c160' : '#ee4d4d';
      return '<div style="margin-top:2px;display:flex;gap:4px;align-items:center;flex-wrap:wrap"><span style="background:rgba(' + (qd.qRemaining > 0 ? '52,199,89' : '255,59,48') + ',.12);color:' + rc + ';padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600">余' + qd.qRemaining + '/' + qd.qCapacity + '</span>' + (qd.qQueue > 0 ? '<span style="background:rgba(255,159,26,.12);color:#ff9f1a;padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600">排队' + qd.qQueue + '人</span>' : '') + '</div>';
    }
    return '';
  }
  const bf = c.baseFlag || baseFlag(ac);
  return fullProbGrid(ac, bf).replace(/margin-top:3px/, 'margin-top:2px');
};

NX.renderDrafts = function () {
  const { esc, state, store, baseFlag, allowedFlags, renderPreviewTT, promoteDraft, deleteDraft, exportDraft } = NX;
  const { savedDrafts, allCourses } = state;
  const $ = state.$;
  const el = $('nextthuxk-drafts');
  if (!el) return;
  if (!savedDrafts.length) { el.innerHTML = ''; return; }
  const { expandedDraft } = state;
  el.innerHTML = savedDrafts.map((d, di) => {
    const cr = d.courses.reduce((s, c) => s + (c.credits || 0), 0);
    const dt = new Date(d.createdAt);
    const exp = expandedDraft === di;
    let courseList = '';
    if (exp && d.courses.length) {
      courseList = '<div class="nx-draft-courses" style="margin-top:6px;border-top:1px solid rgba(0,0,0,.06);padding-top:6px">';
      d.courses.forEach((c, ci) => {
        const bf = c.baseFlag || (() => { const ac = allCourses.find(x => x.code === c.code); return ac ? baseFlag(ac) : 'rx'; })();
        const aFlags = allowedFlags(bf);
        if (!aFlags.includes(c.flag)) { c.flag = aFlags[0]; store.set('drafts', savedDrafts); }
        const flOpts = aFlags.map(f => '<option value="' + f + '"' + (c.flag === f ? ' selected' : '') + '>' + (f === 'bx' ? '必修' : f === 'xx' ? '限选' : f === 'rx' ? '任选' : '体育') + '</option>').join('');
        const zyOpts = [1, 2, 3].map(z => '<option value="' + z + '"' + (c.zy === z ? ' selected' : '') + '>' + z + '志愿</option>').join('');
        const prob = NX.draftCourseProbHtml(c);
        courseList += '<div style="display:flex;align-items:center;gap:4px;padding:3px 0;font-size:11px;border-bottom:1px solid rgba(0,0,0,.03)">' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#1f2329">' + esc(c.name) + '</span>' +
          '<span style="font-size:10px;color:#9aa1ac">' + c.credits + '学分</span>' +
          '<select class="nx-draft-flag" data-di="' + di + '" data-ci="' + ci + '" style="padding:1px 3px;border-radius:5px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">' + flOpts + '</select>' +
          '<select class="nx-draft-zy" data-di="' + di + '" data-ci="' + ci + '" style="padding:1px 3px;border-radius:5px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer">' + zyOpts + '</select>' +
          prob +
          '<button class="nx-draft-crm" data-di="' + di + '" data-ci="' + ci + '" style="width:16px;height:16px;border-radius:8px;border:none;background:rgba(238,77,77,.1);color:#ee4d4d;font-size:9px;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center">✕</button></div>';
      });
      courseList += '</div>';
    }
    const expIcon = exp ? '▼' : '▶';
    return '<div class="nx-draft-card"><div class="nx-draft-head"><span class="nx-draft-name" style="cursor:pointer" data-toggle="' + di + '">' + expIcon + ' ' + esc(d.name) + '</span><span class="nx-draft-info">' + d.courses.length + '门 · ' + cr + '学分 · ' + (dt.getMonth() + 1) + '/' + dt.getDate() + '</span></div><div class="nx-draft-acts"><button class="nx-draft-view" data-idx="' + di + '">预览 & 修改</button><button class="nx-draft-go" data-idx="' + di + '">提交选课</button><button class="nx-draft-export" data-idx="' + di + '">导出</button><button class="nx-draft-del" data-idx="' + di + '">删除</button></div>' + courseList + '</div>';
  }).join('');
  el.querySelectorAll('[data-toggle]').forEach(span => {
    span.onclick = () => {
      const idx = parseInt(span.dataset.toggle);
      state.expandedDraft = expandedDraft === idx ? -1 : idx;
      NX.renderDrafts();
    };
  });
  el.querySelectorAll('.nx-draft-flag').forEach(sel => {
    sel.onchange = () => {
      const di = parseInt(sel.dataset.di), ci = parseInt(sel.dataset.ci);
      savedDrafts[di].courses[ci].flag = sel.value;
      store.set('drafts', savedDrafts);
      NX.renderDrafts();
      if (state.previewMode === 'draft' && state.previewDraftIdx === di) renderPreviewTT(savedDrafts[di].courses, '草稿「' + savedDrafts[di].name + '」预览');
    };
  });
  el.querySelectorAll('.nx-draft-zy').forEach(sel => {
    sel.onchange = () => {
      const di = parseInt(sel.dataset.di), ci = parseInt(sel.dataset.ci);
      savedDrafts[di].courses[ci].zy = parseInt(sel.value);
      store.set('drafts', savedDrafts);
      NX.renderDrafts();
      if (state.previewMode === 'draft' && state.previewDraftIdx === di) renderPreviewTT(savedDrafts[di].courses, '草稿「' + savedDrafts[di].name + '」预览');
    };
  });
  el.querySelectorAll('.nx-draft-crm').forEach(btn => {
    btn.onclick = () => {
      const di = parseInt(btn.dataset.di), ci = parseInt(btn.dataset.ci);
      const name = savedDrafts[di].courses[ci].name;
      if (!confirm('从草稿移除「' + name + '」？')) return;
      savedDrafts[di].courses.splice(ci, 1);
      NX.invalidatePreview();
      store.set('drafts', savedDrafts);
      NX.renderDrafts();
      if (state.previewMode === 'draft' && state.previewDraftIdx === di) renderPreviewTT(savedDrafts[di].courses, '草稿「' + savedDrafts[di].name + '」预览');
    };
  });
  el.querySelectorAll('.nx-draft-view').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      const d = savedDrafts[idx];
      if (d) { state.previewDraftIdx = idx; renderPreviewTT(d.courses, '草稿「' + d.name + '」预览'); }
    };
  });
  el.querySelectorAll('.nx-draft-go').forEach(btn => {
    btn.onclick = () => {
      const d = savedDrafts[parseInt(btn.dataset.idx)];
      if (!d) return;
      if (!confirm('确定提交「' + d.name + '」？\n将先退选所有已选课程，再选入该草稿中的 ' + d.courses.length + ' 门课程。')) return;
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
};

// ─── Course Detail Modal ──────────────────────────────────────

NX.showCourseModal = async function (code, teacherId) {
  const { esc, state, fetchCourseDetail } = NX;
  const $ = state.$;
  const mask = $('nextthuxk-modal');
  const title = $('nextthuxk-modal-title');
  const body = $('nextthuxk-modal-body');
  const c = state.allCourses.find(x => x.code === code);
  title.textContent = c ? c.name + '（' + code + '）' : code;
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
      html += '<div class="nx-modal-row"><div class="nx-modal-label">' + esc(key) + '</div><div class="nx-modal-val">' + esc(fields[key]) + '</div></div>';
    }
  }
  for (const [k, v] of Object.entries(fields)) {
    if (!order.includes(k) && v && v.length > 0) {
      html += '<div class="nx-modal-row"><div class="nx-modal-label">' + esc(k) + '</div><div class="nx-modal-val">' + esc(v) + '</div></div>';
    }
  }
  body.innerHTML = html || '<div class="nx-modal-loading">暂无信息</div>';
};

// ─── Plan Coverage ────────────────────────────────────────────

NX.checkPlanCoverage = function () {
  const { state } = NX;
  const { allCourses, stageCart, savedDrafts, planData } = state;
  const codes = new Set();
  const detail = {};
  const collect = (list) => list.forEach(c => {
    codes.add(c.code);
    if (!detail[c.code]) detail[c.code] = c;
  });
  collect(allCourses.filter(c => c.selected));
  collect(stageCart);
  savedDrafts.forEach(d => collect(d.courses));
  const isSports = (code) => {
    const c = allCourses.find(x => x.code === code);
    return c && ((c.department || '').includes('体育') || (c.attr || '') === '体育');
  };
  const hasSports = [...codes].some(isSports) || stageCart.some(c => isSports(c.code));
  const isSecondLang = (code) => { const c = allCourses.find(x => x.code === code); return c && (c.name.includes('第二外国语') || c.name.includes('二外')); };
  const hasSecondLang = [...codes].some(isSecondLang) || stageCart.some(c => isSecondLang(c.code));
  const isAdvEnglish = (code) => { const c = allCourses.find(x => x.code === code); return c && (c.name.includes('进阶读写') || c.name.includes('进阶')); };
  const hasAdvEnglish = [...codes].some(isAdvEnglish) || stageCart.some(c => isAdvEnglish(c.code));
  const isBasicEnglish = (code) => { const c = allCourses.find(x => x.code === code); return c && (c.name.includes('阅读写作') || c.name.includes('听说交流')); };

  return planData.map(p => {
    let covered = codes.has(p.code);
    let coveredBy = covered && detail[p.code] ? (detail[p.code].teacher || detail[p.code].name) : '';
    if (!covered && (p.attr === '体育' || p.name.includes('体育') || (p.group || '').includes('体育'))) {
      if (hasSports) { covered = true; coveredBy = '(已有体育课)'; }
    }
    if (!covered && /英语\(3\)/.test(p.name)) {
      if (hasAdvEnglish) { covered = true; coveredBy = '(英语进阶读写)'; }
      else if (hasSecondLang) { covered = true; coveredBy = '(第二外国语替代)'; }
    }
    if (!covered && /英语\([12]\)/.test(p.name)) {
      if ([...codes].some(code => isBasicEnglish(code)) || stageCart.some(c => isBasicEnglish(c.code))) { covered = true; coveredBy = '(英语阅读写作/听说交流)'; }
    }
    return { ...p, covered, coveredBy };
  });
};

NX.renderPlanView = function (searchQuery) {
  const { esc, state } = NX;
  const $ = state.$;
  const el = $('nextthuxk-list');
  const { planData } = state;
  if (!planData.length) { el.innerHTML = '<div class="nx-empty">暂无培养方案数据</div>'; return; }
  const coverage = NX.checkPlanCoverage();
  let filtered = coverage;
  if (searchQuery) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(searchQuery) || p.code.includes(searchQuery) || (p.attr || '').includes(searchQuery));
  }
  const groups = {};
  filtered.forEach(p => { const g = p.group || p.attr || '其他'; if (!groups[g]) groups[g] = []; groups[g].push(p); });
  const totalCr = coverage.reduce((s, c) => s + c.credits, 0);
  const coveredCr = coverage.filter(c => c.covered).reduce((s, c) => s + c.credits, 0);
  const coveredN = coverage.filter(c => c.covered).length;
  let html = '<div style="margin-bottom:14px;padding:12px 16px;border-radius:12px;background:var(--nx-glass);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 0 0 1px var(--nx-line);font-size:13px">' +
    '<strong>培养方案进度</strong>: ' + coveredN + '/' + coverage.length + '门 · ' + coveredCr + '/' + totalCr + '学分' +
    '<div style="margin-top:6px;height:6px;background:rgba(0,0,0,.06);border-radius:3px;overflow:hidden">' +
    '<div style="height:100%;width:' + (totalCr ? Math.round(coveredCr / totalCr * 100) : 0) + '%;background:var(--nx-accent);border-radius:3px"></div></div></div>';
  for (const [groupName, courses] of Object.entries(groups)) {
    const gTotal = courses.reduce((s, c) => s + c.credits, 0);
    const gCovered = courses.filter(c => c.covered).reduce((s, c) => s + c.credits, 0);
    html += '<div style="margin-bottom:14px"><div style="font-size:13px;font-weight:700;color:#1f2329;margin-bottom:6px;padding:5px 12px;background:rgba(29,31,36,.05);border-radius:8px;display:flex;justify-content:space-between"><span>' + esc(groupName) + '</span><span style="font-size:11px;font-weight:400;color:' + (gCovered >= gTotal ? '#07c160' : '#9aa1ac') + '">' + gCovered + '/' + gTotal + '学分</span></div>';
    courses.forEach(p => {
      const icon = p.covered ? '✓' : '✗';
      const bg = p.covered ? 'rgba(7,193,96,.06)' : 'rgba(238,77,77,.04)';
      const statusHtml = p.covered
        ? '<span style="color:#07c160;font-size:11px;white-space:nowrap">' + esc(p.coveredBy || '已满足') + '</span>'
        : '<span style="color:#ee4d4d;font-size:11px">未满足</span>';
      html += '<div class="nx-stage-item" style="background:' + bg + ';gap:8px"><span style="font-size:12px">' + icon + '</span><span class="nx-stage-name">' + esc(p.name) + ' <span style="color:#9aa1ac;font-size:10px">' + p.code + '</span></span><span class="nx-stage-info">' + p.credits + '学分</span>' + statusHtml + '</div>';
    });
    html += '</div>';
  }
  el.innerHTML = html;
};

NX.renderPlan = function (plan) {
  const { esc, state, checkPlanCoverage } = NX;
  const $ = state.$;
  const el = $('nextthuxk-plan');
  const coverage = checkPlanCoverage();
  const groups = {};
  coverage.forEach(c => { const g = c.group || c.attr || '其他'; if (!groups[g]) groups[g] = []; groups[g].push(c); });
  el.innerHTML = Object.entries(groups).map(([name, items]) => {
    const cr = items.reduce((s, c) => s + c.credits, 0);
    const cov = items.filter(c => c.covered).reduce((s, c) => s + c.credits, 0);
    return '<div class="nx-plan-card" data-g="' + esc(name) + '"><div class="nx-plan-num">' + cov + '<small style="font-size:12px;font-weight:400;color:#9aa1ac">/' + cr + '学分</small></div><div class="nx-plan-lbl">' + esc(name) + ' (' + items.length + '门)</div></div>';
  }).join('');
  const detail = $('nextthuxk-plan-detail');
  const total = coverage.reduce((s, c) => s + c.credits, 0);
  const totalCov = coverage.filter(c => c.covered).reduce((s, c) => s + c.credits, 0);
  if (detail) detail.textContent = '共 ' + coverage.length + ' 门，' + totalCov + '/' + total + ' 学分已覆盖';
};

// ─── Filters ──────────────────────────────────────────────────

NX.filterCourses = function () {
  const { state, renderCourses, renderPlanView, lc } = NX;
  const $ = state.$;
  const { allCourses, candidateCourses, activeGroup } = state;
  const q = $('nextthuxk-search').value.toLowerCase();   // 用户输入不入缓存（中间态多），课程字段才走 lc
  NX.updateSearchClear();
  const f = state.shadow.querySelector('.nx-chip.on')?.dataset.f || 'all';
  if (f === 'plan') { renderPlanView(q); return; }
  let list = allCourses;
  if (q) list = list.filter(c => lc(c.name).includes(q) || c.code.includes(q) || lc(c.teacher).includes(q));
  if (f === 'available') list = list.filter(c => c.available);
  else if (f === 'selected') {
    const seen = new Set();
    const candKeys = new Set(candidateCourses.map(c => c.code + '_' + (c.seq || '0')));
    list = list.filter(c => {
      if (!c.selected && !c.isCandidate && !candKeys.has(c.code + '_' + (c.seq || '0'))) return false;
      const k = c.code + '_' + (c.seq || '0');
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }
  else if (f === 'required') list = list.filter(c => c.attr === '必修');
  else if (f === 'elective') list = list.filter(c => c.attr === '限选');
  else if (f === 'sports') list = list.filter(c => c.attr === '体育' || (c.department || '').includes('体育') || (c.department || '').includes('体武'));
  else if (f === 'queue') {
    const qKeys = new Set(candidateCourses.map(c => c.code + '_' + (c.seq || '0')));
    list = list.filter(c => qKeys.has(c.code + '_' + (c.seq || '0')));
  }
  if (activeGroup) list = list.filter(c => (c.group || c.attr) === activeGroup);
  const cf = $('nx-filter-credits')?.value;
  if (cf) {
    if (cf === '5+') list = list.filter(c => c.credits >= 5);
    else list = list.filter(c => c.credits === parseInt(cf));
  }
  const df = $('nx-filter-day')?.value;
  const pf = $('nx-filter-period')?.value;
  if (df || pf) {
    // 正则预编译（原实现在 filter 回调内每门课 new RegExp，6000 次对象创建）
    const bothRe = df && pf ? new RegExp(df + '-' + pf + '\\(') : null;
    const dayRe = df ? new RegExp(df + '-\\d') : null;
    const periodRe = pf ? new RegExp('\\d+-' + pf + '\\(') : null;
    list = list.filter(c => {
      if (!c.time) return false;
      if (bothRe) return bothRe.test(c.time);
      if (dayRe) return dayRe.test(c.time);
      return periodRe.test(c.time);
    });
  }
  const cf2 = $('nx-filter-conflict')?.value;
  if (cf2) {
    list = list.filter(c => {
      const conflicts = NX.findPreviewConflicts(c);
      return cf2 === 'noconflict' ? conflicts.length === 0 : conflicts.length > 0;
    });
  }
  const tsVal = $('nx-filter-tongshi')?.value;
  if (tsVal) {
    const tsMap = { TS1: '人文课组', TS2: '社科课组', TS3: '艺术课组', TS4: '科学课组' };
    list = list.filter(c => (c.tongshiGroup || '').includes(tsMap[tsVal] || ''));
  }
  const featVal = $('nx-filter-feature')?.value;
  if (featVal) list = list.filter(c => (c.courseFeature || '').includes(featVal));
  const gradeVal = $('nx-filter-grade-filter')?.value;
  if (gradeVal) list = list.filter(c => (c.grade || '').includes(gradeVal));
  const bksVal = $('nx-filter-bksrem')?.value;
  if (bksVal === '>0') list = list.filter(c => (c.remaining || 0) > 0);
  const yjsVal = $('nx-filter-yjsrem')?.value;
  if (yjsVal === '>0') list = list.filter(c => (c.gradRemaining || 0) > 0);
  const xkNote = ($('nx-filter-xknote')?.value || '').trim().toLowerCase();
  if (xkNote) list = list.filter(c => lc(c.xkTextNote).includes(xkNote));
  // ─── 社区评价筛选（thubook）───
  const rv = $('nx-filter-reviews')?.value;
  if (rv) {
    const ok = c => {
      const t = c._tbRef;
      if (!t || !t.count) return false;
      if (rv === 'has') return true;
      if (rv === 'cnt5') return t.count >= 5;
      if (rv === 'r45') return t.avg >= 4.5;
      if (rv === 'r40') return t.avg >= 4;
      if (rv === 'low') return t.avg <= 3;
      return true;
    };
    list = list.filter(ok);
  }
  // ─── 排序（复制数组，绝不动 allCourses 本体顺序）───
  const sortBy = $('nx-sort-by')?.value;
  if (sortBy && list.length > 1) {
    list = list.slice().sort((a, b) => {
      const ta = a._tbRef && a._tbRef.count ? a._tbRef : null;
      const tb = b._tbRef && b._tbRef.count ? b._tbRef : null;
      const av = ta ? ta.avg : null, bv = tb ? tb.avg : null;   // 无点评恒排末尾
      const ca = ta ? ta.count : -1, cb = tb ? tb.count : -1;
      if (sortBy === 'rate_desc') return bv == null ? -1 : av == null ? 1 : (bv - av) || (cb - ca);
      if (sortBy === 'rate_asc') return bv == null ? 1 : av == null ? -1 : (av - bv) || (ca - cb);
      if (sortBy === 'cnt_desc') return cb - ca;
      return 0;
    });
  }
  renderCourses(list);
};

NX.updateSearchClear = function () {
  const $ = NX.state.$;
  const btn = $('nextthuxk-search-clear');
  const hasValue = !!$('nextthuxk-search').value.trim();
  btn.classList.toggle('show', hasValue);
};

NX.filterByGroup = function (g) {
  NX.state.activeGroup = g;
  NX.filterCourses();
};
