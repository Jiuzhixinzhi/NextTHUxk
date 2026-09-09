<script lang="ts">
  import type { Flag } from '../../lib/domain/types';
  import { flagName, isSportsCourse } from '../../lib/domain/flags';
  import { probHist } from '../../lib/stores/probhist.svelte.ts';
  import { session } from '../../lib/stores/session.svelte.ts';
  import { probAt, probSeries, probYDomain, sparkPath, trendDelta } from '../../lib/domain/probhist';
  import { fmtTime, keyOf } from '../../lib/core/utils';

  let { code, seq, flag: initFlag, zy: initZy }: { code: string; seq: string; flag: Flag; zy: number } = $props();

  const key = $derived(keyOf(code, seq));
  const course = $derived(session.allCourses.find((c) => keyOf(c.code, c.seq) === key));
  const points = $derived(probHist.map[key] || []);
  const flags = $derived((course && isSportsCourse(course) ? ['ty'] : ['bx', 'xx', 'rx']) as Flag[]);

  let selFlag = $state<Flag>(initFlag);
  let selZy = $state(initZy || 3);

  $effect(() => {
    if (!flags.includes(selFlag)) selFlag = flags[0]!;
    if (selZy < 1 || selZy > 3) selZy = 3;
  });

  const series = $derived.by(() => probSeries(points, selFlag, selZy));
  const delta = $derived.by(() => trendDelta(points, selFlag, selZy));
  const latest = $derived.by(() => (points.length ? probAt(points[points.length - 1]!, selFlag, selZy) : null));

  const W = 480;
  const H = 96;
  const PAD = 6;
  const [yMin, yMax] = $derived(probYDomain(series));
  const yOf = (p: number): number => H - PAD - ((p - yMin) / Math.max(1e-9, yMax - yMin)) * (H - PAD * 2);
  const path = $derived.by(() => sparkPath(series, W, H, PAD, yMin, yMax));
  const gridY = $derived.by(() => (0.5 >= yMin && 0.5 <= yMax ? yOf(0.5) : null));
  const labelFrom = $derived(Math.max(0, series.length - 12));
</script>

<div class="nx-modal-row">
  <div class="nx-modal-label">档位</div>
  <div class="nx-trend-tabs">
    {#each flags as f (f)}
      <button type="button" class="nx-sim-mode" class:on={selFlag === f} onclick={() => (selFlag = f)}>{flagName(f)}</button>
    {/each}
    <span class="nx-trend-zywrap">
      {#each [1, 2, 3] as z (z)}
        <button type="button" class="nx-sim-mode" class:on={selZy === z} onclick={() => (selZy = z)}>{z}志愿</button>
      {/each}
    </span>
  </div>
</div>

{#if points.length === 0}
  <div class="nx-modal-loading">暂无历史快照：志愿统计每次检查点窗口（8/12/16/20 点）到货后开始记录。</div>
{:else if series.length < 2}
  <div class="nx-modal-loading">
    仅 {series.length} 个窗口的数据（{latest ? Math.round((latest.prob >= 0 ? latest.prob : 0) * 100) + '%' : '无数据'}
    {latest && latest.prob >= 0 && latest.ratioLabel ? ' · ' + (latest.ratioLabel || '') : ''}），积累 2 个窗口后可见走势。
  </div>
{:else}
  {@const lastPct = Math.round(series[series.length - 1]!.prob * 100)}
  <div class="nx-trend-meta">
    <span class="nx-trend-cur" style="color:{latest ? latest.color : '#9aa1ac'};">当前 {lastPct}%{latest && latest.ratioLabel ? ' · ' + (latest.ratioLabel || '') : ''}</span>
    {#if delta !== null}
      <span class="nx-trend-delta {delta > 0 ? 'up' : delta < 0 ? 'down' : ''}" title="相对上一窗口">
        {delta > 0 ? '▲ +' + delta + '%' : delta < 0 ? '▼ ' + delta + '%' : '– 0%'}
      </span>
    {/if}
    <span class="nx-trend-last">最后更新 {fmtTime(points[points.length - 1]!.t)}</span>
  </div>
  <div class="nx-trend-plot">
    <svg class="nx-trend-chart" viewBox="0 0 {W} {H}" preserveAspectRatio="none">
      {#if gridY !== null}
        <line class="nx-trend-grid" x1="{PAD}" y1="{gridY}" x2="{W - PAD}" y2="{gridY}" />
      {/if}
      {#if path}
        <polyline class="nx-trend-line" points="{path}" />
      {/if}
      {#each series as s, i (s.t)}
        <circle
          class="nx-trend-dot {i === series.length - 1 ? 'last' : ''}"
          cx="{PAD + ((s.t - series[0]!.t) / Math.max(1, series[series.length - 1]!.t - series[0]!.t)) * (W - PAD * 2)}"
          cy="{yOf(s.prob)}"
          r="3"
        >
          <title>{fmtTime(s.t)} · {Math.round(s.prob * 100)}%</title>
        </circle>
      {/each}
    </svg>
    <span class="nx-trend-ylbl top">{Math.round(yMax * 100)}%</span>
    <span class="nx-trend-ylbl bot">{Math.round(yMin * 100)}%</span>
    {#each series as s, i (s.t)}
      {#if i >= labelFrom}
        {@const xPct = ((PAD + ((s.t - series[0]!.t) / Math.max(1, series[series.length - 1]!.t - series[0]!.t)) * (W - PAD * 2)) / W) * 100}
        <span
          class="nx-trend-lbl"
          class:dn={i % 2 === 1}
          class:edge0={i === 0}
          class:edge1={i === series.length - 1}
          style="--x:{xPct.toFixed(2)}%;--y:{(yOf(s.prob) / H) * 100}%;"
        >{Math.round(s.prob * 100)}%</span
        >
      {/if}
    {/each}
  </div>
  <div class="nx-trend-axis">
    <span>{fmtTime(series[0]!.t)}</span>
    <span>{fmtTime(series[Math.floor((series.length - 1) / 2)]!.t)}</span>
    <span>{fmtTime(series[series.length - 1]!.t)}</span>
  </div>
  <div class="nx-trend-foot">按检查点窗口（8/12/16/20 点）记录志愿统计快照 · 保留最近 60 窗口（约 15 天）</div>
{/if}
