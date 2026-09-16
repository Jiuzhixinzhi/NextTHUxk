<script lang="ts">
  import { resolveZyModal } from '../../../lib/stores/modal.svelte.ts';
  import type { Course } from '../../../lib/domain/types';

  let { courses }: { courses: Course[] } = $props();

  let zySel: number[] = $state([]);

  $effect(() => {
    zySel = courses.map((c) => c.zy || 3);
  });
</script>

<div class="nx-zy-hint">以下课程未能自动获取志愿信息，请手动确认：</div>
{#each courses as c, i}
  <div class="nx-zy-row">
    <span class="nx-zy-name">{c.name}</span>
    <span class="nx-zy-type">{c.typeLabel || '?'}</span>
    <select class="nx-zy-select" value={String(zySel[i] ?? 3)} onchange={(e) => { zySel[i] = parseInt((e.currentTarget as HTMLSelectElement).value) || 3; zySel = [...zySel]; }}>
      <option value="1">第1志愿</option>
      <option value="2">第2志愿</option>
      <option value="3">第3志愿</option>
    </select>
  </div>
{/each}
<div style="padding:12px 0 0;display:flex;justify-content:flex-end;">
  <button class="nx-zy-ok" onclick={() => resolveZyModal(zySel)}>确认</button>
</div>
