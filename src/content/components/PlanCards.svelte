<script lang="ts">
  import { planCov } from '../../lib/stores/session.svelte.ts';
  import { setChip } from '../../lib/stores/search.svelte.ts';

  const coverageRows = $derived(planCov.rows);

  const groups = $derived.by(() => {
    const g = new Map<string, { cov: number; cr: number; n: number }>();
    coverageRows.forEach((c) => {
      const name = c.group || c.attr || '其他';
      if (!g.has(name)) g.set(name, { cov: 0, cr: 0, n: 0 });
      const e = g.get(name)!;
      e.cr += c.credits;
      e.cov += (c.covered ? c.credits : 0);
      e.n++;
    });
    return [...g.entries()].map(([name, v]) => ({ name, ...v }));
  });

  const total = $derived.by(() => {
    const cr = coverageRows.reduce((s, c) => s + c.credits, 0);
    const cov = coverageRows.filter((c) => c.covered).reduce((s, c) => s + c.credits, 0);
    return { cr, cov, n: coverageRows.length };
  });
</script>

<div class="nx-sec">
  <div class="nx-sec-title">我的培养方案</div>
  {#if coverageRows.length}
    <div class="grid gap-2" style="grid-template-columns:1fr 1fr;">
      {#each groups as g}
        <div class="nx-plan-card" title="点击在培养方案视图查看本组" onclick={() => setChip('plan')}>
          <div class="nx-plan-num">{g.cov}<small style="font-size:12px;font-weight:400;color:var(--nx-faint);">/{g.cr}学分</small></div>
          <div class="nx-plan-lbl">{g.name} ({g.n}门)</div>
        </div>
      {/each}
    </div>
    <div style="margin-top:8px;font-size:12px;color:var(--nx-ink-soft);">共 {total.n} 门，{total.cov}/{total.cr} 学分已覆盖</div>
  {:else}
    <div class="nx-st">等待加载…</div>
  {/if}
</div>
