<script lang="ts">
  import type { DraftCourse, Flag } from '../../lib/domain/types';
  import { allowedFlags, flagName } from '../../lib/domain/flags';
  import { currentProbMeta, QUEUE_CAP_STYLE, queueCapLevel } from '../../lib/domain/probability';
  import { session } from '../../lib/stores/session.svelte.ts';
  import { jumpTo } from '../../lib/stores/search.svelte.ts';
  import { keyOf } from '../../lib/core/utils';

  let { course, onFlag, onZy, onRemove }: { course: DraftCourse; onFlag: (f: Flag) => void; onZy: (z: number) => void; onRemove: () => void } = $props();

  const ac = $derived.by(() => session.allCourses.find((x: { code: string; seq: string }) => keyOf(x.code, x.seq) === keyOf(course.code, course.seq)));
  const meta = $derived.by(() => (ac ? currentProbMeta(ac, course.flag, course.zy) : null));
  const qd = $derived.by(() => session.queueDataMap[keyOf(course.code, course.seq)]);
  /** 余位档位（与课表块/课程卡同源）：无 qd 数据在课余量阶段按已满显示（旧版同款） */
  const capLv = $derived.by(() => queueCapLevel(qd?.qRemaining, qd?.qQueue ?? 0));
  // 已选/排队徽章：派生自池行状态（快照行不落冗余字段）——上游 PR #53 同款
  const selState = $derived.by(() => {
    const k = keyOf(course.code, course.seq);
    if (session.candidateCourses.some((x: { code: string; seq: string }) => keyOf(x.code, x.seq) === k)) return '排队';
    if (ac && (ac as { selected?: boolean }).selected) return '已选';
    return '';
  });
</script>

<div style="display:flex;align-items:center;gap:4px;padding:3px 0;font-size:11px;border-bottom:1px solid rgba(0,0,0,.03);">
  <span
    class="nx-jumpable"
    title="点击按课号搜索此课程"
    style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--nx-ink);cursor:pointer;"
    onclick={() => jumpTo(course.code, course.seq, course.teacher)}
  >{course.name}</span
  >
  {#if selState}
    <span
      style="font-size:9px;font-weight:600;padding:0 4px;border-radius:4px;white-space:nowrap;{selState === '排队' ? 'color:#ff9f1a;background:rgba(255,159,26,.14);' : 'color:#07c160;background:rgba(7,193,96,.14);'}"
      title="该课在教务侧{selState === '排队' ? '处于候补队列' : '已选入课表'}"
    >{selState}</span>
  {/if}
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
    <span style="font-size:10px;color:{QUEUE_CAP_STYLE[capLv].color};font-weight:600;white-space:nowrap;"
      >{capLv === 'ok' ? `余${qd!.qRemaining}/${qd!.qCapacity}` : capLv === 'queued' ? `排队${qd!.qQueue}人` : '已满'}</span
    >
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
