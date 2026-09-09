<script lang="ts">
  import { onMount } from 'svelte';
  import { curVer, BUILD } from '../lib/core/constants';

  let status = $state('检测中…');
  let ok = $state(false);

  const HOST_RE = /zhjwxk\.cic\.tsinghua\.edu\.cn|zhjw\.cic\.tsinghua\.edu\.cn|webvpn\.tsinghua\.edu\.cn/;

  onMount(async () => {
    try {
      const tabs: { id?: number; url?: string }[] = await chrome?.tabs?.query({ active: true, currentWindow: true });
      const url = tabs && tabs[0] && tabs[0].url ? tabs[0].url : '';
      if (!url || !url.startsWith('http')) {
        status = '未在教务站点';
        ok = false;
        return;
      }
      if (HOST_RE.test(new URL(url).hostname)) {
        status = '已检测到清华教务站点';
        ok = true;
      } else {
        status = '请打开清华选课网站后使用';
        ok = false;
      }
    } catch {
      status = '无法访问当前标签页';
      ok = false;
    }
  });

  async function onOpen() {
    try {
      const tabs: { id?: number }[] = await chrome?.tabs?.query({ active: true, currentWindow: true });
      const id = tabs[0]?.id;
      if (id == null) return;
      await chrome?.tabs?.sendMessage(id, { action: 'nextthuxk-toggle' });
      window.close();
    } catch {
      status = '未在教务站点';
      ok = false;
    }
  }
</script>

<div class="pop-root" style="padding:16px 18px 14px;display:flex;flex-direction:column;gap:12px;">
  <div class="flex items-center gap-2">
    <span class="othu-logo" style="font-size:13px;">
      <span class="lp">(</span><span class="word"><i>O</i><i>n</i><i>e</i></span><span></span><span class="lp"> </span><span class="tu">T</span><span class="tu">H</span><span class="tu">U</span><span class="lp">)</span>
    </span>
    <span style="font-size:14px;font-weight:700;letter-spacing:.05em;">NextTHUxk</span>
    <span style="margin-left:auto;font-size:9px;color:rgba(31,35,41,.4);">v{curVer()} · {BUILD}</span>
  </div>

  <div
    style="padding:10px 12px;border-radius:12px;font-size:12px;background:rgba(255,255,255,.55);backdrop-filter:var(--nx-glass-blur);-webkit-backdrop-filter:var(--nx-glass-blur);box-shadow:var(--nx-glass-edge),var(--nx-glass-shadow);display:flex;align-items:center;gap:7px;"
  >
    {#if ok}
      <span style="width:8px;height:8px;border-radius:50%;background:#07c160;"></span>
    {:else}
      <span style="width:8px;height:8px;border-radius:50%;background:#ee4d4d;"></span>
    {/if}
    <span>{status}</span>
  </div>

  <button
    style="padding:10px 0;border-radius:12px;border:none;background:var(--nx-accent);color:#fff;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;box-shadow:0 4px 14px rgba(47,107,255,.3);"
    onclick={() => void onOpen()}
  >启动选课工作台</button
  >
  <div style="font-size:10px;color:var(--nx-faint);text-align:center;">下一代选课 · 随时查询 · 草稿编排</div>
</div>
