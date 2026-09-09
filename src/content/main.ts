// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 内容脚本入口：域名守卫 → Shadow DOM → mount(App)
// ═══════════════════════════════════════════════════════════════
import { mount } from 'svelte';
import App from './App.svelte';
import css from './app.css?inline';
import { TAG, BUILD, curVer } from '../lib/core/constants';
import { bootSite, session } from '../lib/stores/session.svelte.ts';
import { loadDrafts, draftStore } from '../lib/stores/drafts.svelte.ts';

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

  // popup 转发：启动/展示工作台
  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener((msg: { action?: string }) => {
      if (msg && msg.action === 'nextthuxk-toggle') {
        if (!session.open) {
          void bootAndLaunch();
        } else {
          session.open = false;
        }
      }
    });
  } else if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg: { action?: string }) => {
      if (msg && msg.action === 'nextthuxk-toggle') {
        if (!session.open) {
          void bootAndLaunch();
        } else {
          session.open = false;
        }
      }
    });
  }
}

async function bootAndLaunch(): Promise<void> {
  if (!session.open) {
    await loadDrafts().catch(() => {});
    const { launch } = await import('../lib/stores/session.svelte.ts');
    await launch();
  } else {
    session.open = true;
  }
  void draftStore;
}

void main();
