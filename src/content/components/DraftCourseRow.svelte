<script lang="ts">
  import type { DraftCourse, Flag } from '../../lib/domain/types';
  import { allowedFlags, flagName } from '../../lib/domain/flags';
  import { probGridData } from '../../lib/domain/probability';
  import { session } from '../../lib/stores/session.svelte.ts';
  import { jumpTo } from '../../lib/stores/search.svelte.ts';
  import { keyOf } from '../../lib/core/utils';

  let { course, onFlag, onZy, onRemove }: { course: DraftCourse; onFlag: (f: Flag) => void; onZy: (z: number) => void; onRemove: () => void } = $props();

  let _flag: Flag = $state(course.flag);
  let _zy: number = $state(course.zy);

  $effect(() => {
    if (_flag !== course.flag) _flag = course.flag;
    if (_zy !== course.zy) _zy = course.zy;
  });

  const ac = $derived.by(() => session.allCourses.find((x: { code: string; seq: string }) => x.code === course.code && String(x.seq || '0') === String(course.seq || '0')));
  const grid = $derived.by(() => (ac ? probGridData(ac) : []));
  const qd = $derived.by(() => session.queueDataMap[keyOf(course.code, course.seq)]);
</script>

<div style="display:flex;align-items:center;gap:4px;padding:3px 0;font-size:11px;border-bottom:1px solid rgba(0,0,0,.03);">
  <span
    class="nx-jumpable"
    title="点击按课号搜索此课程"
    style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--nx-ink);cursor:pointer;"
    onclick={() => jumpTo(course.code, course.seq)}
  >{course.name}</span
  >
  <span style="font-size:10px;color:var(--nx-faint);">{course.credits}学分</span>
  <select
    style="padding:1px 3px;border-radius:5px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer;"
    value={_flag}
    onchange={(e) => onFlag((e.currentTarget as HTMLSelectElement).value as Flag)}
  >
    {#each allowedFlags(course.baseFlag) as f}
      <option value={f}>{flagName(f)}</option>
    {/each}
  </select>
  <select
    style="padding:1px 3px;border-radius:5px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer;"
    value={String(_zy)}
    onchange={(e) => onZy(parseInt((e.currentTarget as HTMLSelectElement).value) || 3)}
  >
    {#each [1, 2, 3] as z}
      <option value={z}>{z}志愿</option>
    {/each}
  </select>

  {#if session.isQueuePhase}
    {#if qd && qd.qRemaining > 0}
      <span style="font-size:10px;color:#07c160;font-weight:600;white-space:nowrap;">余{qd.qRemaining}/{qd.qCapacity}</span>
    {:else if qd && qd.qQueue > 0}
      <span style="font-size:10px;color:#ff9f1a;font-weight:600;white-space:nowrap;">排队{qd.qQueue}人</span>
    {:else}
      <span style="font-size:10px;color:#ee4d4d;font-weight:600;white-space:nowrap;">已满</span>
    {/if}
  {:else}
    {#if grid.length}
      <span style="font-size:9px;color:var(--nx-ink-soft);white-space:nowrap;">
        {#each grid as row}
          {flagName(row.flag)}: {row.cells.map((c) => c.zy + '志愿' + c.label).join(' / ')}
        {/each}
      </span>
    {/if}
  {/if}

  <button
    style="width:16px;height:16px;border-radius:8px;border:none;background:rgba(238,77,77,.1);color:#ee4d4d;font-size:9px;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;"
    onclick={onRemove}
  >✕</button
  >
</div>
