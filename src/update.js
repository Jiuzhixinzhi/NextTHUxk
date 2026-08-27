// ═══════════════════════════════════════════════════════════════
// NextTHUxk — Update: 版本更新检查
// ═══════════════════════════════════════════════════════════════
var NX = NX || {};

NX.cmpVer = function (a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
};

NX.volNeedsRefresh = function (volTs) {
  if (!volTs) return true;
  const now = new Date();
  const hours = [8, 12, 16, 20];
  let lastUpdate = new Date(now);
  lastUpdate.setHours(hours[0], 0, 0, 0);
  for (let i = hours.length - 1; i >= 0; i--) {
    const t = new Date(now);
    t.setHours(hours[i], 0, 0, 0);
    if (now >= t) { lastUpdate = t; break; }
    if (i === 0) {
      lastUpdate = new Date(now);
      lastUpdate.setDate(lastUpdate.getDate() - 1);
      lastUpdate.setHours(hours[hours.length - 1], 0, 0, 0);
    }
  }
  return volTs < lastUpdate.getTime();
};

NX.fmtTime = function (ts) {
  if (!ts) return '无';
  const d = new Date(ts);
  return d.getMonth() + 1 + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
};

NX.checkUpdate = async function () {
  const { esc, store, CUR_VER, DANGEROUS_VERS } = NX;
  if (DANGEROUS_VERS.includes(CUR_VER)) {
    NX.showDangerBanner();
    return;
  }
  try {
    const lastCheck = await store.get('lastUpdateCheck');
    if (lastCheck && Date.now() - lastCheck < 30 * 60 * 1000) return;
    const resp = await fetch('https://api.github.com/repos/smartThise/NextTHUxk/releases/latest', { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    await store.set('lastUpdateCheck', Date.now());
    const remote = (data.tag_name || '').replace(/^v/, '');
    if (remote && NX.cmpVer(remote, CUR_VER) > 0) {
      NX.showUpdateBanner(remote, data.html_url);
    }
  } catch (e) { /* silent */ }
  const { state } = NX;
  if (!state.updateTimer) {
    state.updateTimer = setInterval(() => {
      store.set('lastUpdateCheck', 0);
      NX.checkUpdate();
    }, 30 * 60 * 1000);
  }
};

NX.showUpdateBanner = function (ver, url) {
  const { esc } = NX;
  const $ = NX.state.$;
  const existing = $('nextthuxk-update-banner');
  if (existing) return;
  const db = $('nextthuxk-dashboard');
  if (!db) return;
  const banner = document.createElement('div');
  banner.id = 'nextthuxk-update-banner';
  banner.innerHTML =
    '<div class="nx-lg-banner">' +
    '<span>发现新版本 <b style="color:#2f6bff">v' + esc(ver) + '</b>，建议更新获取最新功能与修复' +
    '<br><small style="opacity:.72;font-weight:400">更新前建议先在 <b>chrome://extensions 扩展管理界面移除旧版</b>，再加载新版，避免新旧实例冲突</small></span>' +
    '<div style="display:flex;gap:8px;align-items:center;">' +
    '<a href="' + url + '" target="_blank" style="color:inherit;background:rgba(29,31,36,.06);padding:4px 12px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:600;">前往下载</a>' +
    '<button id="nextthuxk-update-close" style="background:none;border:none;color:inherit;cursor:pointer;font-size:15px;line-height:1;">✕</button>' +
    '</div></div>';
  db.prepend(banner);
  $('nextthuxk-update-close').onclick = () => banner.remove();
};

NX.showDangerBanner = function () {
  const { esc, CUR_VER } = NX;
  const $ = NX.state.$;
  const existing = $('nextthuxk-danger-banner');
  if (existing) return;
  const db = $('nextthuxk-dashboard');
  if (!db) return;
  const banner = document.createElement('div');
  banner.id = 'nextthuxk-danger-banner';
  banner.innerHTML =
    '<div class="nx-lg-banner" style="box-shadow:var(--nx-glass-edge), 0 8px 32px rgba(238,77,77,.25);">' +
    '<span>当前版本 <b style="color:#ee4d4d">v' + esc(CUR_VER) + '</b> 存在严重错误，请立即升级到 <a href="https://github.com/smartThise/NextTHUxk/releases/latest" target="_blank" style="color:#ee4d4d;font-weight:700;text-decoration:underline">最新版本</a>' +
    '<br><small style="opacity:.72;font-weight:400">安装前请先在 <b>chrome://extensions 移除本版本</b>，避免新旧实例冲突</small></span>' +
    '<button id="nextthuxk-danger-close" style="background:none;border:none;color:inherit;cursor:pointer;font-size:15px;line-height:1;">✕</button>' +
    '</div>';
  db.prepend(banner);
  $('nextthuxk-danger-close').onclick = () => banner.remove();
};
