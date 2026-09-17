// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 内容脚本入口：域名守卫 → Shadow DOM → mount(App)
// ═══════════════════════════════════════════════════════════════
import { mount } from 'svelte';
import App from './App.svelte';
import css from './app.css?inline';
import { TAG, BUILD, curVer } from '../lib/core/constants';
  import { bootSite } from '../lib/stores/session.svelte.ts';

async function main(): Promise<void> {
  if (window.parent !== window) return;
  if (!/zhjwxk|zhjw\.cic|webvpn/.test(location.hostname)) return;
  console.log(TAG, 'v' + curVer() + ' 构建 ' + BUILD + ' loading on', location.href);

  const host = document.createElement('div');
  host.id = 'nextthuxk-host';
  host.style.cssText =
    'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-size:14px;line-height:1.5;';
  (document.documentElement || document.body).appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  try {
    await bootSite();
  } catch (e) {
    console.warn(TAG, 'site identity:', e);
  }

  mount(App, { target: shadow });

  // popup 转发：翻转工作台（browser/chrome 双形态同一处理器；launch 中弹「正在加载」）
  const onToggle = (msg: { action?: string }): void => {
    if (msg && msg.action === 'nextthuxk-toggle') void toggleFromPopup();
  };
  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener(onToggle);
  } else if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(onToggle);
  }
}

async function toggleFromPopup(): Promise<void> {
  const { toggleWorkbench } = await import('../lib/stores/launch.svelte.ts');
  toggleWorkbench();
}

void main();
