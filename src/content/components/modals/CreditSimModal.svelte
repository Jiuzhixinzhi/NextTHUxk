<script lang="ts">
  import { session } from '../../../lib/stores/session.svelte.ts';
  import { creditSimItems, creditDist } from '../../../lib/domain/probability';
  import { flagName } from '../../../lib/domain/flags';
  import type { CreditSimItem, DraftCourse } from '../../../lib/domain/types';

  let { courses, certainKeys }: { courses: DraftCourse[]; certainKeys?: string[] } = $props();

  const sim = $state({ mode: 'live' as 'live' | 'override', items: [] as CreditSimItem[] });
  let inputValues: (number | null)[] = $state([]);
  let simTargetInput: string = $state('0');

  $effect(() => {
    const cs = courses;
    const keys = certainKeys;
    const items = creditSimItems(cs, {
      isQueuePhase: session.isQueuePhase,
      queueDataMap: session.queueDataMap as never,
      courseLookup: (code, seq) => session.allCourses.find((x) => x.code === code && String(x.seq || '0') === String(seq || '0')),
      certainKeys: keys && keys.length ? new Set(keys) : undefined,
    });
    sim.items = items;
    sim.mode = 'live';
    inputValues = items.map((it) => (it.liveProb === null ? null : Math.round(it.liveProb * 100)));
    const total = items.reduce((s, it) => s + it.credits, 0);
    simTargetInput = String(total ? Math.max(0, Math.round(total * 0.5)) : 0);
  });

  const simResult = $derived.by(() => {
    if (!sim.items.length) return null;
    const items = sim.items.map((it, i) => {
      const v = inputValues[i] ?? null;
      const eff = v === null ? null : Math.min(Math.max(v, 0), 100) / 100;
      return { ...it, prob: sim.mode === 'live' ? it.liveProb : eff };
    });
    const withProb = items.filter((it) => it.prob !== null);
    if (!withProb.length) return null;
    const dist = creditDist(items);
    if (!dist.points.length) return null;
    const target = Number.isFinite(Number(simTargetInput)) ? Number(simTargetInput) : Math.round(dist.expected);
    const atLeast = dist.points.reduce((acc, pt) => acc + (pt.credits >= target ? pt.prob : 0), 0);
    return { dist, target, atLeast, maxP: Math.max(...dist.points.map((p) => p.prob)) };
  });

  function isDirty(it: CreditSimItem, i: number): boolean {
    const cur = inputValues[i] ?? null;
    if (it.liveProb === null) return cur !== null;
    return cur === null || Math.abs(Math.min(Math.max(cur, 0), 100) / 100 - it.liveProb) > 1e-9;
  }

  function onSimProb(i: number, v: string) {
    inputValues[i] = v === '' ? null : Math.min(Math.max(parseFloat(v) || 0, 0), 100);
    inputValues = [...inputValues];
  }
</script>

<div class="nx-sim-modes">
  <button class="nx-sim-mode" class:on={sim.mode === 'live'} onclick={() => (sim.mode = 'live')}>实时取值</button>
  <button class="nx-sim-mode" class:on={sim.mode === 'override'} onclick={() => (sim.mode = 'override')}>手动覆盖</button>
</div>
<div class="nx-sim-note">每门课中签概率（实时取值随所选身份/志愿；切「手动覆盖」可修改，留空 = 暂不计入）</div>
{#if sim.items.length}
  <div class="flex flex-col">
    {#each sim.items as it, i (i)}
      <div class="nx-sim-row">
        <span class="nx-sim-name" title={it.name}>{it.name}</span>
        <span class="nx-sim-cred">{it.credits}学分</span>
        {#if it.certain}
          <span class="nx-sim-tag" title="课余量阶段已确认选入，概率恒 100%">已选锁定</span>
        {:else if it.flag && it.zy}
          <span class="nx-sim-tag">{flagName(it.flag)} · {it.zy}志愿</span>
        {/if}
        <input
          class="nx-sim-prob"
          type="number"
          min="0"
          max="100"
          step="1"
          disabled={sim.mode === 'live'}
          value={inputValues[i] ?? ''}
          placeholder="0-100"
          onchange={(e) => onSimProb(i, (e.currentTarget as HTMLInputElement).value)}
        />
        {#if isDirty(it, i)}
          <span class="nx-sim-dirty" title="已手动覆盖">改</span>
        {/if}
      </div>
    {/each}
  </div>
  {#if simResult}
    {@const excluded = sim.items.filter((it) => it.prob === null).length}
    <div class="nx-sim-stats">
      <div class="nx-sim-stat">
        <div class="nx-sim-stat-v">{simResult.dist.expected.toFixed(2)}</div>
        <div class="nx-sim-stat-k">期望学分</div>
      </div>
      <div class="nx-sim-stat">
        <div class="nx-sim-stat-v">{simResult.dist.mode}</div>
        <div class="nx-sim-stat-k">最可能学分</div>
      </div>
      <div class="nx-sim-stat">
        <div class="nx-sim-stat-v">{Math.round(simResult.atLeast * 10000) / 100}%</div>
        <div class="nx-sim-stat-k">≥ <input type="number" style="width:46px;padding:1px 4px;border:1px solid rgba(0,0,0,.12);border-radius:5px;font-size:10px;text-align:center;" bind:value={simTargetInput} /> 学分</div>
      </div>
      <div class="nx-sim-stat">
        <div class="nx-sim-stat-v" style="font-size:11px;margin-top:6px;">
          {sim.items.length} 门{#if excluded}（<span style="color:#ee4d4d">{excluded} 门未计入</span>）{/if}
        </div>
        <div class="nx-sim-stat-k">参与统计</div>
      </div>
    </div>
    <div class="nx-sim-histo">
      {#each simResult.dist.points as pt}
        <div class="nx-sim-bar-col" title="{pt.credits} 学分 · {Math.round(pt.prob * 1000) / 10}%">
          <div class="nx-sim-bar-val">{Math.round(pt.prob * 1000) / 10}%</div>
          <div class="nx-sim-bar" style="height:{Math.max(3, Math.round((pt.prob / simResult.maxP) * 84))}px;"></div>
          <div class="nx-sim-bar-x">{pt.credits}</div>
        </div>
      {/each}
    </div>
    <div class="nx-sim-table-wrap" style="max-height:180px;overflow-y:auto;">
      <table class="nx-sim-table">
        <thead><tr><th>总学分</th><th>概率</th><th>至少拿到 (≥)</th></tr></thead>
        <tbody>
          {#each simResult.dist.points as pt, i (i)}
            {@const atLeast = simResult.dist.points.slice(i).reduce((s, p) => s + p.prob, 0)}
            <tr><td>{pt.credits}</td><td>{Math.round(pt.prob * 10000) / 100}%</td><td>{Math.round(atLeast * 10000) / 100}%</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="nx-sim-foot">假设各课中签相互独立（志愿级联已计入单课概率）</div>
  {:else}
    <div class="nx-st">实时数据尚未就绪（无志愿统计 / 课余量阶段已满排队）——可切「手动覆盖」填写</div>
  {/if}
{:else}
  <div class="nx-modal-loading">没有可模拟的课程</div>
{/if}
