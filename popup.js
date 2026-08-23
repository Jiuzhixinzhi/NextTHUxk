const _browser = typeof browser !== 'undefined' ? browser : chrome;
const statusEl = document.getElementById('status');
const launchBtn = document.getElementById('launch');

_browser.tabs.query({ active: true, currentWindow: true }, tabs => {
  const tab = tabs[0];
  if (!tab) { statusEl.textContent = '无法获取标签页'; return; }
  const url = tab.url || '';
  if (/zhjwxk\.cic\.tsinghua\.edu\.cn|zhjw\.cic\.tsinghua\.edu\.cn|webvpn\.tsinghua\.edu\.cn/.test(url)) {
    statusEl.textContent = '已连接选课系统';
    statusEl.className = 'status ok';
  } else {
    statusEl.textContent = '请先打开清华选课网站';
    statusEl.className = 'status err';
  }
});

launchBtn.onclick = () => {
  _browser.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    _browser.tabs.sendMessage(tabs[0].id, { action: 'nextthuxk-toggle' }, resp => {
      if (_browser.runtime.lastError) {
        statusEl.textContent = '请先打开清华选课网站并刷新';
        statusEl.className = 'status err';
      } else {
        window.close();
      }
    });
  });
};
