<script lang="ts">
  import { toast } from '../../../lib/stores/toast.svelte.ts';
</script>

{#if toast.on}
  <div
    class:nx-toast-ok={toast.ok}
    class:nx-toast-err={!toast.ok}
    style="position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:9px 18px;border-radius:999px;font-size:12.5px;font-weight:600;z-index:200;pointer-events:none;box-shadow:0 8px 32px rgba(28,39,64,.18);color:#fff;transition:opacity .3s ease;opacity:1;"
  >
    {toast.msg}
  </div>
{/if}

