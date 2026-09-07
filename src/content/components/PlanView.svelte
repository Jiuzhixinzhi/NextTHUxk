<script lang="ts">
  import { coverageRows } from '../../lib/stores/session.svelte.ts';
  import { search } from '../../lib/stores/search.svelte.ts';
  import { jumpTo } from '../../lib/stores/search.svelte.ts';
  import { lc } from '../../lib/core/utils';

  const list = $derived.by(() => {
    const q = search.q.trim().toLowerCase();
    if (!coverageRows.length) return { rows: [], coveredCr: 0, totalCr: 0, coveredN: 0, totalN: 0 };
    const filtered = q
      ? coverageRows.filter((p) => lc(p.name).includes(q) || p.code.includes(q) || lc(p.attr).includes(q))
      : coverageRows;
    return {
      rows: filtered,
      coveredCr: coverageRows.filter((c) => c.covered).reduce((s, c) => s + c.credits, 0),
      totalCr: coverageRows.reduce((s, c) => s + c.credits, 0),
      coveredN: coverageRows.filter((c) => c.covered).length,
      totalN: coverageRows.length,
    };
  });

  function groups() {
    const g = new Map<string, typeof list.rows>();
    list.rows.forEach((p) => {
      const name = p.group || p.attr || '其他';
      if (!g.has(name)) g.set(name, []);
      g.get(name)!.push(p);
    });
    return [...g.entries()];
  }
</script>

{#if !list.totalN}
  <div class="nx-empty">暂无培养方案数据</div>
{:else}
  <div style="margin-bottom:14px;padding:12px 16px;border-radius:12px;background:var(--nx-glass);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 0 0 1px var(--nx-line);font-size:13px;">
    <strong>培养方案进度</strong>: {list.coveredN}/{list.totalN}门 · {list.coveredCr}/{list.totalCr}学分
    <div style="margin-top:6px;height:6px;background:rgba(0,0,0,.06);border-radius:3px;overflow:hidden;">
      <div style="height:100%;width:{list.totalCr ? Math.round((list.coveredCr / list.totalCr) * 100) : 0}%;background:var(--nx-accent);border-radius:3px;"></div>
    </div>
  </div>

  {#each groups() as [groupName, courses]}
    <div style="margin-bottom:14px;">
      <div
        style="font-size:13px;font-weight:700;color:var(--nx-ink);margin-bottom:6px;padding:5px 12px;background:rgba(29,31,36,.05);border-radius:8px;display:flex;justify-content:space-between;"
      >
        <span>{groupName}</span>
        <span style="font-size:11px;font-weight:400;color:{courses.filter((c) => c.covered).reduce((s, c) => s + c.credits, 0) >= courses.reduce((s, c) => s + c.credits, 0) ? '#07c160' : '#9aa1ac'};">
          {courses.filter((c) => c.covered).reduce((s, c) => s + c.credits, 0)}/{courses.reduce((s, c) => s + c.credits, 0)}学分
        </span>
      </div>
      {#each courses as p}
        <div
          class="nx-stage-item"
          style="background:{p.covered ? 'rgba(7,193,96,.06)' : 'rgba(238,77,77,.04)'};gap:8px;cursor:pointer;"
          title="点击按课号搜索此课程"
          onclick={() => jumpTo(p.code, '0')}
        >
          <span style="font-size:12px;color:{p.covered ? '#07c160' : '#ee4d4d'};">{p.covered ? '✓' : '✗'}</span>
          <span class="nx-stage-name">{p.name} <span style="color:var(--nx-faint);font-size:10px;">{p.code}</span></span>
          <span class="nx-stage-info">{p.credits}学分</span>
          <span style="color:{p.covered ? '#07c160' : '#ee4d4d'};font-size:11px;white-space:nowrap;">{p.covered ? (p.coveredBy || '已满足') : '未满足'}</span>
        </div>
      {/each}
    </div>
  {/each}
{/if}
