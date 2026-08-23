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
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:linear-gradient(90deg,#667eea,#764ba2);color:#fff;font-size:13px;border-radius:8px;margin:8px 0;">' +
    '<span>发现新版本 v' + esc(ver) + '，建议更新获取最新功能与修复</span>' +
    '<div style="display:flex;gap:8px;align-items:center;">' +
    '<a href="' + url + '" target="_blank" style="color:#fff;background:rgba(255,255,255,0.2);padding:4px 12px;border-radius:4px;text-decoration:none;font-size:12px;">前往下载</a>' +
    '<button id="nextthuxk-update-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;line-height:1;">✕</button>' +
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
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:linear-gradient(90deg,#ff3b30,#ff6b6b);color:#fff;font-size:13px;border-radius:8px;margin:8px 0;">' +
    '<span>当前版本 v' + esc(CUR_VER) + ' 存在严重错误，请立即升级到 <a href="https://github.com/smartThise/NextTHUxk/releases/latest" target="_blank" style="color:#fff;font-weight:700;text-decoration:underline">最新版本</a></span>' +
    '<button id="nextthuxk-danger-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;line-height:1;">✕</button>' +
    '</div>';
  db.prepend(banner);
  $('nextthuxk-danger-close').onclick = () => banner.remove();
};
