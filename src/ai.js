// ═══════════════════════════════════════════════════════════════
// NextTHUxk — AI: AI 搜索 + 智能排课
// ═══════════════════════════════════════════════════════════════
var NX = NX || {};

NX.aiSearch = async function () {
  const { esc, state, baseFlag, parseTimeSlots, findPreviewConflicts, showXkResult, addToStage } = NX;
  const $ = state.$;
  const api = $('nextthuxk-api').value.trim();
  const model = $('nextthuxk-model').value.trim() || 'gpt-4o-mini';
  const token = $('nextthuxk-token').value.trim();
  const prompt = $('nextthuxk-ai-search-prompt')?.value?.trim() || '';
  const pref = $('nextthuxk-pref')?.value?.trim() || '';
  const st = $('nextthuxk-ai-search-st');
  const results = $('nextthuxk-ai-search-results');
  const btn = $('nextthuxk-ai-search');

  if (!api || !token) { st.className = 'nx-st err'; st.textContent = '❌ 请先填写 API URL 和 Token'; return; }
  if (!prompt) { st.className = 'nx-st err'; st.textContent = '❌ 请输入搜索描述'; return; }

  st.className = 'nx-st'; st.innerHTML = '<span class="nx-spin"></span> AI 正在搜索…';
  btn.disabled = true;
  results.innerHTML = '';

  try {
    const { allCourses, candidateCourses, stageCart, savedDrafts, previewMode, previewDraftIdx } = state;
    const q = $('nextthuxk-search').value.toLowerCase();
    const f = state.shadow.querySelector('.nx-chip.on')?.dataset.f || 'all';
    let filtered = [...allCourses];
    if (q) filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || c.code.includes(q) || (c.teacher || '').toLowerCase().includes(q));
    if (f === 'available') filtered = filtered.filter(c => c.available);
    else if (f === 'required') filtered = filtered.filter(c => c.attr === '必修');
    else if (f === 'elective') filtered = filtered.filter(c => c.attr === '限选');
    else if (f === 'sports') filtered = filtered.filter(c => c.attr === '体育' || (c.department || '').includes('体育'));

    let previewCourses = [];
    let previewLabel = '无';
    if (previewMode === 'selected') {
      previewCourses = allCourses.filter(c => c.selected).concat(candidateCourses.filter(cc => !allCourses.some(ac => ac.selected && ac.code === cc.code)));
      previewLabel = '当前已选';
    } else if (previewMode === 'stage') {
      previewCourses = stageCart; previewLabel = '暂存区';
    } else if (previewMode === 'draft' && previewDraftIdx >= 0 && savedDrafts[previewDraftIdx]) {
      previewCourses = savedDrafts[previewDraftIdx].courses; previewLabel = '草稿「' + savedDrafts[previewDraftIdx].name + '」';
    }

    const occupiedSlots = [];
    previewCourses.forEach(c => {
      parseTimeSlots(c.time || '').forEach(({ day, slot }) => {
        const k = day + ' ' + slot;
        if (!occupiedSlots.find(s => s.key === k)) {
          occupiedSlots.push({ key: k, day, slot, name: c.name || c.code });
        }
      });
    });

    const courseList = filtered.map(c => {
      const conflicts = findPreviewConflicts(c);
      return {
        name: c.name, code: c.code, seq: c.seq, credits: c.credits,
        teacher: c.teacher, time: c.time, department: c.department,
        attr: c.attr, remaining: c.remaining, capacity: c.capacity,
        conflict: conflicts.length > 0,
        conflictWith: conflicts.map(cf => cf.name).join(', '),
        available: c.available, selected: c.selected,
        tongshiGroup: c.tongshiGroup, courseFeature: c.courseFeature, grade: c.grade,
      };
    });

    const apiPrompt = '你是清华大学选课AI助手。学生想在已筛选的课程中找课。\n\n' +
      '## 当前预览课表：' + previewLabel + '（' + previewCourses.length + '门）\n' +
      '已占用时间：' + (occupiedSlots.length ? occupiedSlots.map(s => s.key + '(' + s.name + ')').join('、') : '无') + '\n\n' +
      '## 候选课程（共' + courseList.length + '门，已按用户条件筛选）\n' +
      JSON.stringify(courseList.slice(0, 200)) + '\n\n' +
      '## 学生需求\n' + prompt + '\n\n' +
      '## 学生偏好\n' + (pref || '无特殊偏好') + '\n\n' +
      '请从候选课程中推荐最匹配学生需求的课程。优先推荐不与预览课表冲突的课。如需推荐冲突课程请明确说明。\n\n' +
      '返回纯JSON（不要markdown代码块），格式：\n' +
      '{"recommendations":[{"code":"课程号","seq":"课序号","name":"课名","reason":"推荐理由（一句话）","conflict":false,"conflictWith":""}],"summary":"总体建议"}\n\n' +
      'conflict为true表示该课与预览课表时间冲突。最多推荐10门。';

    const resp = await fetch(api.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: '你是选课助手，只返回JSON。' }, { role: 'user', content: apiPrompt }], temperature: 0.3 })
    });
    if (!resp.ok) throw new Error('API HTTP ' + resp.status);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('API 返回为空');
    const result = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

    const recs = result.recommendations || [];
    if (!recs.length) {
      results.innerHTML = '<div class="nx-st">未找到匹配课程</div>';
    } else {
      results.innerHTML = (result.summary ? '<div class="nx-st ok" style="margin-bottom:8px">' + esc(result.summary) + '</div>' : '')
        + recs.map(r => {
          const course = allCourses.find(c => c.code === r.code && String(c.seq || '0') === String(r.seq || '0'));
          const isConflict = r.conflict || (course && findPreviewConflicts(course).length > 0);
          const borderColor = isConflict ? '#ff9500' : r.conflict ? '#ff3b30' : '#34c759';
          const conflictHtml = isConflict ? '<div style="font-size:10px;color:#ff9500;margin-top:4px">⚠ 与' + esc(r.conflictWith || '预览课表') + '时间冲突</div>' : '';
          const addBtn = course && !course.selected ? '<button class="nx-stage-btn" data-code="' + esc(r.code) + '" data-seq="' + esc(r.seq || '0') + '" style="margin-top:4px;font-size:10px">暂存</button>' : '';
          return '<div style="padding:10px;margin-top:6px;border-radius:10px;border-left:3px solid ' + borderColor + ';background:rgba(0,0,0,.02)">' +
            '<div style="font-weight:700;font-size:13px">' + esc(r.name) + ' <span style="color:#86868b;font-weight:400">' + esc(r.code) + '</span></div>' +
            '<div style="font-size:11px;color:#86868b;margin-top:2px">' + (course ? esc(course.teacher || '') + ' · ' + esc(course.time || '') : '') + '</div>' +
            '<div style="font-size:12px;margin-top:4px;color:#1d1d1f">' + esc(r.reason) + '</div>' +
            conflictHtml + addBtn + '</div>';
        }).join('');
      results.querySelectorAll('.nx-stage-btn').forEach(b => {
        b.onclick = () => {
          const ac = allCourses.find(c => c.code === b.dataset.code && String(c.seq || '0') === String(b.dataset.seq || '0'));
          if (ac) addToStage(ac.code, ac.seq, baseFlag(ac), 3);
        };
      });
    }
    st.className = 'nx-st ok';
    st.textContent = '✅ 找到 ' + recs.length + ' 门推荐课程';
  } catch (e) {
    st.className = 'nx-st err'; st.textContent = '❌ ' + e.message;
  } finally { btn.disabled = false; }
};

NX.callAI = async function () {
  const { esc, state, store, baseFlag, detectConflicts, showXkResult } = NX;
  const $ = state.$;
  const api = $('nextthuxk-api').value.trim();
  const model = $('nextthuxk-model').value.trim() || 'gpt-4o-mini';
  const token = $('nextthuxk-token').value.trim();
  const pref = $('nextthuxk-pref').value.trim();
  const st = $('nextthuxk-ai-st');
  const btn = $('nextthuxk-ai');
  if (!api || !token) { st.className = 'nx-st err'; st.textContent = '❌ 请填写 API URL 和 Token'; return; }
  st.className = 'nx-st'; st.innerHTML = '<span class="nx-spin"></span> AI 正在分析课程数据…';
  btn.disabled = true;
  try {
    const { allCourses, savedDrafts, SEM, GRADE } = state;
    const bxTyCourses = allCourses.filter(c => c.attr === '必修' || c.attr === '体育' || (c.department || '').includes('体育')).map(c =>
      ({ name: c.name, code: c.code, seq: c.seq || '', credits: c.credits, time: c.time || '', teacher: c.teacher || '', available: c.available, attr: c.attr, remaining: c.remaining }));
    const selectedInfo = allCourses.filter(c => c.selected).map(c => ({ name: c.name, code: c.code, seq: c.seq, credits: c.credits, time: c.time, zy: c.zy, typeLabel: c.typeLabel }));
    const selectedCredits = selectedInfo.reduce((s, c) => s + (c.credits || 0), 0);
    const draftsInfo = savedDrafts.map(d => ({ name: d.name, courses: d.courses.map(c => ({ name: c.name, code: c.code, seq: c.seq, time: c.time, flag: c.flag, zy: c.zy, credits: c.credits })) }));

    const prompt = '你是清华大学选课AI助手。请根据以下信息推荐最优选课方案，确保无时间冲突。\n\n' +
      '## 用户信息\n- 当前年级：' + ('大一大二大三大四'[GRADE - 1] || '未知') + '（第' + GRADE + '年本科）\n- 当前学期：' + SEM + '\n\n' +
      '## 本学期可选的必修课和体育课（时间格式：星期-大节(周次)，如 3-2(全周) 表示周三第2大节）\n' +
      JSON.stringify(bxTyCourses, null, 1) + '\n\n' +
      '## 当前已选课表（' + selectedInfo.length + '门 · ' + selectedCredits + '学分）\n' +
      (selectedInfo.length ? JSON.stringify(selectedInfo, null, 1) : '无') + '\n\n' +
      '## 已保存的暂存课表\n' +
      (draftsInfo.length ? JSON.stringify(draftsInfo, null, 1) : '无') + '\n\n' +
      '## 用户偏好\n' + (pref || '无特殊偏好，请合理推荐') + '\n\n' +
      '重要约束：\n1. 只推荐与用户年级匹配的课程。例如大三学生不应选大一大二的体育课(如体育(1)、体育(2))，应选体育(3)或以上。\n' +
      '2. 课程名中的数字通常表示年级段：体育(1)=大一体育，体育(2)=大二体育，体育(3)=大三体育。\n' +
      '3. 请根据已有课表的时间空隙，从必修课和体育课中选择合适的课程组合。\n' +
      '4. 对于任选课和通识课，不需要逐门搜索，只需根据已有课表的空闲时段给出选课方向建议即可。\n\n' +
      '返回纯JSON（不要markdown代码块），格式：\n' +
      '{"courses":[{"code":"课号","seq":"课序","name":"课名","credits":3,"time":"3-2(全周)","teacher":"教师","flag":"bx","zy":3,"reason":"推荐理由"}],"total_credits":30,"summary":"整体分析","suggestions":["对任选/通识课的建议"]}\n\n' +
      'flag: bx=必修 xx=限选 rx=任选 ty=体育。zy: 志愿号1-3。结果将直接存入暂存草稿。';

    const resp = await fetch(api.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: '你是选课助手，只返回JSON。' }, { role: 'user', content: prompt }], temperature: 0.3 })
    });
    if (!resp.ok) throw new Error('API HTTP ' + resp.status);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('API 返回为空');
    const schedule = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

    // Load AI result into staging cart
    const { renderStageCart, renderPreviewTT, askReplaceDraft } = NX;
    state.stageCart = (schedule.courses || []).map(c => {
      const ac = allCourses.find(x => x.code === c.code);
      return {
        code: c.code, seq: c.seq || '0', name: c.name || '', teacher: c.teacher || '',
        time: c.time || '', credits: c.credits || 0, flag: c.flag || 'bx', zy: c.zy || 3,
        baseFlag: c.baseFlag || (ac ? baseFlag(ac) : 'rx'),
      };
    });
    renderStageCart();
    renderPreviewTT(state.stageCart, 'AI 推荐方案');
    store.set('stageCart', state.stageCart);

    const aiName = 'AI推荐';
    const saved = askReplaceDraft(aiName, state.stageCart);
    if (saved) {
      state.stageCart = [];
      renderStageCart();
      store.set('stageCart', state.stageCart);
    }

    const conflicts = detectConflicts(state.stageCart.length ? state.stageCart : (state.savedDrafts[state.savedDrafts.length - 1]?.courses || []));
    st.className = conflicts.length ? 'nx-st err' : 'nx-st ok';
    let msg = conflicts.length
      ? '⚠ AI方案有 ' + conflicts.length + ' 处时间冲突，请手动调整'
      : '✅ AI方案已生成！' + (schedule.courses?.length || 0) + '门课 · ' + (schedule.total_credits || '?') + '学分';
    if (saved) msg += ' — 已保存为「' + aiName + '」';
    else msg += ' — 仅保留在暂存区';
    if (schedule.summary) msg += '\n' + schedule.summary;
    if (schedule.suggestions?.length) msg += '\n建议: ' + schedule.suggestions.join('; ');
    st.textContent = msg;

    store.set('config', { api, model, token, pref });
  } catch (e) {
    st.className = 'nx-st err'; st.textContent = '❌ ' + e.message;
  } finally { btn.disabled = false; }
};
