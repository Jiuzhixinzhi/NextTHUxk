<script lang="ts">
  import { banner, clearBanner, CUR_VER } from '../../../lib/stores/session.svelte.ts';
</script>

{#if banner.kind !== 'none'}
  <div
    class="nx-lg-banner"
    style={banner.kind === 'danger' ? 'box-shadow:var(--nx-glass-edge),0 8px 32px rgba(238,77,77,.25);' : ''}
  >
    <span>
      {#if banner.kind === 'update'}
        发现新版本 <b style="color:var(--nx-accent)">v{banner.ver}</b>，建议更新获取最新功能与修复
        <br />
        <small style="opacity:.72;font-weight:400;">更新前建议先在扩展管理界面移除旧版，再加载新版，避免新旧实例冲突</small>
      {:else}
        当前版本 <b style="color:var(--nx-red)">v{CUR_VER}</b> 存在严重错误，请立即升级到
        <a href="https://github.com/smartThise/NextTHUxk/releases/latest" target="_blank" style="color:var(--nx-red);font-weight:700;">最新版本</a>
        <br />
        <small style="opacity:.72;font-weight:400;">安装前请先移除本版本，避免新旧实例冲突</small>
      {/if}
    </span>
    <div class="flex items-center gap-2">
      {#if banner.kind === 'update'}
        <a
          href={banner.url}
          target="_blank"
          style="color:inherit;background:rgba(29,31,36,.06);padding:4px 12px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:600;"
        >前往下载</a
        >
      {/if}
      <button
        style="background:none;border:none;color:inherit;cursor:pointer;font-size:15px;line-height:1;"
        onclick={clearBanner}
      >✕</button
      >
    </div>
  </div>
{/if}
