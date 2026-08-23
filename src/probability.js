// ═══════════════════════════════════════════════════════════════
// NextTHUxk — Probability: 中签概率计算、志愿格式化
// ═══════════════════════════════════════════════════════════════
var NX = NX || {};

NX.fmtVol = function (v) {
  if (!v) return '';
  const priMatch = v.match(/^\((\d+)\)/);
  const pri = priMatch ? parseInt(priMatch[1]) : 0;
  const cleaned = v.replace(/^\(\d+\)/, '');
  const parts = cleaned.split(',').map(n => parseInt(n) || 0);
  if (parts.every(n => n === 0) && !pri) return '';
  let s = parts.join('/');
  if (pri) s = '优先' + pri + '/' + s;
  return s;
};

NX.volColor = function (course) {
  const cap = course.volCapacity || course.capacity || 0;
  const applied = course.volApplied || 0;
  if (!cap || cap === 0) return { level: 'unknown', color: '#86868b', bg: 'rgba(134,134,139,.08)', pct: 0 };
  const ratio = applied / cap;
  if (ratio <= 0.8) return { level: 'easy', color: '#34c759', bg: 'rgba(52,199,89,.1)', pct: Math.min(ratio * 100, 100) };
  if (ratio <= 1.2) return { level: 'medium', color: '#ff9500', bg: 'rgba(255,149,0,.1)', pct: Math.min(ratio * 100, 100) };
  return { level: 'hard', color: '#ff3b30', bg: 'rgba(255,59,48,.1)', pct: Math.min(ratio * 100, 100) };
};

NX.parseVolArr = function (s) {
  if (!s) return null;
  const priMatch = String(s).match(/^\((\d+)\)/);
  const pri = priMatch ? parseInt(priMatch[1]) : 0;
  const cleaned = String(s).replace(/^\(\d+\)/, '');
  const nums = cleaned.match(/\d+/g);
  if (!nums || nums.length < 3) return null;
  const arr = nums.slice(0, 3).map(n => parseInt(n, 10) || 0);
  arr.priority = pri;
  return arr;
};

NX.calcProb = function (course, flag, zy) {
  const cap = parseInt(course.volCapacity || course.capacity || 0, 10) || 0;
  if (!cap) return { prob: -1, label: '无数据', color: '#86868b' };

  const zyIdx = zy - 1;

  // 体育：独立级联，只看体育志愿
  if (flag === 'ty') {
    const vols = NX.parseVolArr(course.volSports);
    if (!vols) return { prob: -1, label: '无数据', color: '#86868b' };
    let rem = cap;
    for (let i = 0; i < zyIdx; i++) rem -= vols[i];
    return NX.probResult(rem, vols[zyIdx]);
  }

  // 必修/限选/任选：全局级联
  const bxV = NX.parseVolArr(course.volRequired);
  const xxV = NX.parseVolArr(course.volElective);
  const rxV = NX.parseVolArr(course.volOptional);

  let rem = cap;

  // 必修级联
  if (bxV) {
    if (flag === 'bx') {
      for (let i = 0; i < zyIdx; i++) rem -= bxV[i];
      return NX.probResult(rem, bxV[zyIdx]);
    }
    for (let i = 0; i < 3; i++) rem -= bxV[i];
  }

  // 限选级联
  if (xxV) {
    if (flag === 'xx') {
      for (let i = 0; i < zyIdx; i++) rem -= xxV[i];
      return NX.probResult(rem, xxV[zyIdx]);
    }
    for (let i = 0; i < 3; i++) rem -= xxV[i];
  }

  // 任选级联（优先志愿为最高优先级，相当于第0志愿）
  if (rxV) {
    const pri = rxV.priority || 0;
    if (flag === 'rx') {
      rem -= pri;
      for (let i = 0; i < zyIdx; i++) rem -= rxV[i];
      return NX.probResult(rem, rxV[zyIdx]);
    }
    rem -= pri;
    for (let i = 0; i < 3; i++) rem -= rxV[i];
  }

  return { prob: -1, label: '无数据', color: '#86868b' };
};

NX.probResult = function (rem, applicants) {
  if (!Number.isFinite(rem) || !Number.isFinite(applicants)) {
    return { prob: -1, label: '无数据', percentLabel: '无数据', ratioLabel: '无数据', color: '#86868b' };
  }
  const remShown = Math.max(0, Math.round(rem));
  const applicantsShown = Math.max(0, Math.round(applicants));
  if (rem <= 0) return { prob: 0, label: '0%', percentLabel: '0%', ratioLabel: remShown + '/' + applicantsShown, color: '#ff3b30' };
  const prob = applicants === 0 ? 1 : Math.min(1, rem / applicants);
  if (!Number.isFinite(prob)) return { prob: -1, label: '无数据', percentLabel: '无数据', ratioLabel: '无数据', color: '#86868b' };
  let color;
  if (prob >= 0.8) color = '#34c759';
  else if (prob >= 0.5) color = '#ff9500';
  else color = '#ff3b30';
  const percentLabel = Math.round(prob * 100) + '%';
  const ratioLabel = remShown + '/' + applicantsShown;
  return { prob, label: percentLabel, percentLabel, ratioLabel, color };
};

NX.flagName = function (flag) {
  return flag === 'bx' ? '必修' : flag === 'xx' ? '限选' : flag === 'rx' ? '任选' : '体育';
};

NX.probBg = function (color) {
  if (color === '#34c759') return 'rgba(52,199,89,.14)';
  if (color === '#ff9500') return 'rgba(255,149,0,.14)';
  if (color === '#ff3b30') return 'rgba(255,59,48,.14)';
  return 'rgba(142,142,147,.12)';
};

NX.currentProbMeta = function (course, flag, zy) {
  const p = NX.calcProb(course, flag, zy);
  return {
    ...p,
    flag,
    zy,
    flagLabel: NX.flagName(flag),
    bg: NX.probBg(p.color),
  };
};

NX.currentProbLine = function (course, flag, zy) {
  const { esc } = NX;
  const p = NX.currentProbMeta(course, flag, zy);
  const pillClass = p.prob >= 0 ? '' : ' nx-prob-pill-muted';
  const pillStyle = p.prob >= 0 ? 'style="background:' + p.bg + ';color:' + p.color + '"' : '';
  const detail = p.ratioLabel && p.ratioLabel !== '无数据' ? ' · ' + p.ratioLabel : '';
  return '<div class="nx-prob-line nx-current-prob" data-code="' + esc(course.code) + '" data-seq="' + esc(course.seq || '0') + '" data-flag="' + esc(flag) + '" data-zy="' + esc(zy) + '"><span class="nx-prob-label">当前选法</span><span class="nx-prob-pill' + pillClass + '" ' + pillStyle + '>' + esc(p.flagLabel) + ' · ' + p.zy + '志愿 · ' + (p.percentLabel || p.label) + detail + '</span></div>';
};

NX.fullProbGrid = function (courseOrAc, bf) {
  const aFlags = NX.allowedFlags(bf);
  const rows = [];
  for (const f of aFlags) {
    const cells = [];
    for (let z = 1; z <= 3; z++) {
      const p = NX.calcProb(courseOrAc, f, z);
      if (p.prob >= 0) {
        cells.push('<span style="color:' + p.color + ';font-weight:600">' + z + '志愿:' + p.label + '</span>');
      } else {
        cells.push('<span style="color:#86868b">' + z + '志愿:' + p.label + '</span>');
      }
    }
    rows.push('<span style="color:#86868b;font-size:9px">' + NX.flagName(f) + '</span> ' + cells.join(' '));
  }
  return rows.length ? '<div style="margin-top:3px;line-height:1.4;font-size:9px">' + rows.join('<br>') + '</div>' : '';
};
