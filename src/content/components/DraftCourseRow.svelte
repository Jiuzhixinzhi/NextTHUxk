<script lang="ts">
  import type { DraftCourse, Flag } from '../../lib/domain/types';
  import { allowedFlags, flagName } from '../../lib/domain/flags';
  import { currentProbMeta } from '../../lib/domain/probability';
  import { session } from '../../lib/stores/session.svelte.ts';
  import { jumpTo } from '../../lib/stores/search.svelte.ts';
  import { keyOf } from '../../lib/core/utils';

  let { course, onFlag, onZy, onRemove }: { course: DraftCourse; onFlag: (f: Flag) => void; onZy: (z: number) => void; onRemove: () => void } = $props();

  const ac = $derived.by(() => session.allCourses.find((x: { code: string; seq: string }) => x.code === course.code && String(x.seq || '0') === String(course.seq || '0')));
  const meta = $derived.by(() => (ac ? currentProbMeta(ac, course.flag, course.zy) : null));
  const qd = $derived.by(() => session.queueDataMap[keyOf(course.code, course.seq)]);
</script>

<div style="display:flex;align-items:center;gap:4px;padding:3px 0;font-size:11px;border-bottom:1px solid rgba(0,0,0,.03);">
  <span
    class="nx-jumpable"
    title="点击按课号搜索此课程"
    style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--nx-ink);cursor:pointer;"
    onclick={() => jumpTo(course.code, course.seq, course.teacher)}
  >{course.name}</span
  >
  <span style="font-size:10px;color:var(--nx-faint);">{course.credits}学分</span>
  <select
    style="padding:1px 3px;border-radius:5px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer;"
    value={course.flag}
    onchange={(e) => onFlag((e.currentTarget as HTMLSelectElement).value as Flag)}
  >
    {#each allowedFlags(course.baseFlag) as f}
      <option value={f}>{flagName(f)}</option>
    {/each}
  </select>
  <select
    style="padding:1px 3px;border-radius:5px;border:1px solid rgba(0,0,0,.1);font-size:10px;font-family:inherit;background:#fff;cursor:pointer;"
    value={String(course.zy)}
    onchange={(e) => onZy(parseInt((e.currentTarget as HTMLSelectElement).value) || 3)}
  >
    <option value="1">1志愿</option>
    <option value="2">2志愿</option>
    <option value="3">3志愿</option>
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
    {#if meta}
      <span
        style="font-size:10px;font-weight:600;color:{meta.color};white-space:nowrap;"
        title="{flagName(course.flag)} · {course.zy}志愿 · {meta.percentLabel}{meta.ratioLabel && meta.ratioLabel !== '无数据' ? ' · 申' + meta.ratioLabel.split('/')[0] + '/余' + meta.ratioLabel.split('/')[1] : ''}"
      >{meta.percentLabel || meta.label}</span
      >
    {/if}
  {/if}

  <button
    style="width:16px;height:16px;border-radius:8px;border:none;background:rgba(238,77,77,.1);color:#ee4d4d;font-size:9px;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;"
    onclick={onRemove}
  >✕</button
  >
</div>
