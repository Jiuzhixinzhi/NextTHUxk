<script lang="ts">
  import type { Course, Flag } from '../../lib/domain/types';
  import { ZY_LIMITS } from '../../lib/core/constants';
  import { allowedFlags, baseFlag, canAdjustZy, flagName, isSportsCourse, typeCodeToFlag } from '../../lib/domain/flags';
  import { currentProbMeta, fmtVol, occupancyOf, probGridData, volColor } from '../../lib/domain/probability';
  import { ORIGIN_COLORS, originOf } from '../../lib/domain/time';
  import { session, doChangeVolunteer, doDropCourse } from '../../lib/stores/session.svelte.ts';
  import { selectedPreviewRows } from '../../lib/stores/session.svelte.ts';
  import type { Course as CourseType } from '../../lib/domain/types';
  import { addCourseToActive } from '../../lib/stores/drafts.svelte.ts';
  import { showToast } from '../../lib/stores/toast.svelte.ts';
  import { confirmDialog, openWindow } from '../../lib/stores/modal.svelte.ts';
  import { buildPreviewSlotIndex, conflictsWithPreview } from '../../lib/domain/conflict';
  import { keyOf, normSeq } from '../../lib/core/utils';

  let { course }: { course: Course } = $props();

  let open_ = $state(false);
  let busy = $state(false);
  let selFlag = $state<string>(baseFlag(course));
  let selZy = $state<number>(3);

  $effect(() => {
    // 等值守卫：仅在真正变化时写，消除「写→失效→重跑」振荡面
    const nf = course.selected ? typeCodeToFlag(course.typeCode) : selFlag;
    const nz = course.selected ? course.zy || 3 : selZy;
    if (nf !== selFlag) selFlag = nf;
    if (nz !== selZy) selZy = nz;
  });

  const origins = $derived(originOf(course.code));
  const isSports = $derived(isSportsCourse(course));
  const vc = $derived(volColor(course, session.isQueuePhase));
  const occ = $derived(occupancyOf(course, session.isQueuePhase));
  const compLabel = $derived(vc.level === 'easy' ? '竞争宽松' : vc.level === 'medium' ? '竞争适中' : vc.level === 'hard' ? '竞争激烈' : '');

  const qKey = $derived(course.code + '_' + normSeq(course.seq));
  const qd = $derived(session.queueDataMap[qKey]);
  const cand = $derived(session.candidateCourses.find((cc) => keyOf(cc.code, cc.seq) === keyOf(course.code, course.seq)));

  function volParts(): string[] {
    const parts: string[] = [];
    if (isSports && course.volSports && course.volSports !== '0,0,0') {
      const s = fmtVol(course.volSports);
      if (s) parts.push('体 ' + s);
    } else {
      if (course.volRequired && course.volRequired !== '0,0,0') {
        const s = fmtVol(course.volRequired);
        if (s) parts.push('必 ' + s);
      }
      if (course.volElective && course.volElective !== '0,0,0') {
        const s = fmtVol(course.volElective);
        if (s) parts.push('限 ' + s);
      }
      if (course.volOptional && course.volOptional !== '0,0,0') {
        const s = fmtVol(course.volOptional);
        if (s) parts.push('任 ' + s);
      }
    }
    return parts;
  }

  function queueInfo(): string {
    if (cand) {
      const rem = qd ? `余${qd.qRemaining}/${qd.qCapacity}` : '';
      return `排队第${cand.myPos}名 / 共${cand.queueTotal}人` + (rem ? ` · ${rem}` : '');
    }
    if (qd) return qd.qRemaining > 0 ? `余${qd.qRemaining}/${qd.qCapacity}` : qd.qQueue > 0 ? `已满(容量${qd.qCapacity}) · 排队${qd.qQueue}人` : `已满(容量${qd.qCapacity})`;
    return '';
  }

  const curFlag = $derived(course.selected ? typeCodeToFlag(course.typeCode) : (selFlag as Flag));
  const curZy = $derived(course.selected ? course.zy || 3 : selZy);
  const meta = $derived.by(() => currentProbMeta(course, curFlag, curZy));
  const grid = $derived.by(() => probGridData(course));

  const conflicts = $derived.by(() => {
    const idx = buildPreviewSlotIndex(selectedPreviewRows() as Course[], session.manualEvents);
    return conflictsWithPreview(course, idx);
  });

  function onAddDraft() {
    const res = addCourseToActive(course, selFlag as Flag, selZy);
    showToast(res.ok, res.msg);
  }

  async function onDrop() {
    const isQueue = session.candidateCourses.some((c) => keyOf(c.code, c.seq) === keyOf(course.code, course.seq));
    if (!(await confirmDialog(isQueue ? `退出候补队列「${course.name}」？` : `退选「${course.name}」？`, isQueue ? '候补位次将丢失，重新排队需等待。' : '教务确认后生效。'))) return;
    busy = true;
    try {
      const res = await doDropCourse(course.code, course.seq);
      showToast(res.ok, res.msg);
    } finally {
      busy = false;
    }
  }

  async function onVolChange(dir: 'up' | 'down') {
    const zy = course.zy || 1;
    const target = dir === 'up' ? zy - 1 : zy + 1;
    if (target < 1 || target > 3) return;
    const res = await doChangeVolunteer(course.code, course.seq, target);
    showToast(res.ok, res.msg);
  }

  function canAdj(target: number): boolean {
    return canAdjustZy(session.allCourses, course, target, ZY_LIMITS);
  }
</script>

<div
  class:selected={course.selected}
  class:open={open_}
  class="nx-card"
  onclick={(e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'BUTTON' || t.tagName === 'SELECT') return;
    open_ = !open_;
  }}
>
  <div class="flex items-center gap-2">
    <span style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{course.name}</span>
    {#if course._tbRef && course._tbRef.count}
      <button
        type="button"
        class="nx-tb-badge {course._tbRef.avg >= 4.5 ? 'lv-hi' : course._tbRef.avg >= 4 ? 'lv-good' : course._tbRef.avg >= 3 ? 'lv-mid' : 'lv-bad'}"
        title="THU选课社区评分 · 点击查看全部点评"
        onclick={(e) => {
          e.stopPropagation();
          openWindow({ kind: 'reviews', code: course.code, seq: course.seq });
        }}
      >★{Number(course._tbRef.avg).toFixed(1)}<i>{course._tbRef.count}评</i></button
      >
    {/if}
    <span style="margin-left:auto;font-size:11px;color:var(--nx-faint);white-space:nowrap;">{course.credits}学分</span>
  </div>
  <div style="font-size:11px;color:var(--nx-faint);margin-bottom:3px;">{course.code}{course.seq ? ' · ' + course.seq + '课序' : ''}</div>

  <div class="flex flex-wrap gap-1">
    {#if origins}
      <span class="nx-tag" style="color:#fff;background:{ORIGIN_COLORS[origins] || '#666'};border:none;">{origins}</span>
    {/if}
    {#if course.available}
      <span class="nx-tag nx-tag-ok">可选</span>
    {:else}
      <span class="nx-tag nx-tag-no">已满</span>
    {/if}
    {#if course.selected}
      <span class="nx-tag nx-tag-sel">已选</span>
    {/if}
    {#if course.attr === '必修'}
      <span class="nx-tag nx-tag-req">必修</span>
    {:else if course.attr === '限选'}
      <span class="nx-tag nx-tag-ele">限选</span>
    {:else if course.attr === '任选'}
      <span class="nx-tag nx-tag-opt">任选</span>
    {/if}
    {#if course.teacher}
      <span class="nx-tag">{course.teacher}</span>
    {/if}
    {#if course.time}
      <span class="nx-tag">{course.time}</span>
    {/if}
    {#if course.department}
      <span class="nx-tag">{course.department}</span>
    {/if}
  </div>

  {#if session.isQueuePhase && queueInfo()}
    <div style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <span
        style="font-size:11px;font-weight:600;color:{cand ? '#ff9f1a' : qd && qd.qRemaining > 0 ? '#07c160' : '#ee4d4d'};"
      >{queueInfo()}</span
      >
      {#if qd && qd.qQueue > 0 && !cand}
        <span style="font-size:11px;color:var(--nx-amber);">排队 {qd.qQueue}人</span>
      {/if}
    </div>
  {:else}
    {#if volParts().length}
      <div class="flex flex-wrap gap-1.5" style="margin-top:3px;">
        {#each volParts() as p}
          <span style="font-size:10.5px;color:var(--nx-ink-soft);">{p}</span>
        {/each}
      </div>
    {/if}
    {#if occ.cap > 0}
      <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
        <span style="height:4px;border-radius:2px;flex:1;min-width:30px;background:linear-gradient(90deg,{vc.color} {vc.pct}%, rgba(0,0,0,.06) {vc.pct}%);"></span>
        <span style="font-size:10px;font-weight:600;color:{vc.color};white-space:nowrap;">{occ.applied}/{occ.cap} · {compLabel}</span>
      </div>
    {/if}
    <div class="nx-prob-line" style="margin-top:4px;">
      <span class="nx-prob-label">当前选法</span>
      <span
        class:nx-prob-pill-muted={meta.prob < 0}
        class="nx-prob-pill"
        style="padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:600;background:{meta.bg};color:{meta.color};"
      >{meta.flagLabel} · {meta.zy}志愿 · {meta.percentLabel || meta.label}{meta.ratioLabel && meta.ratioLabel !== '无数据' ? ' · ' + meta.ratioLabel : ''}</span
      >
    </div>
    {#if grid.length > 0}
      <div style="margin-top:3px;line-height:1.4;font-size:9px;">
        {#each grid as row}
          <div>
            <span style="color:var(--nx-faint);font-size:9px;">{flagName(row.flag)}</span>
            {#each row.cells as cell}
              <span style="color:{cell.color};font-weight:600;">{cell.zy}志愿:{cell.label}</span>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if conflicts.length > 0}
    <div style="font-size:10px;color:var(--nx-red);margin-top:3px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
      <span>冲突:</span>
      {#each conflicts.slice(0, 3) as cf}
        <span style="background:rgba(238,77,77,.1);padding:1px 6px;border-radius:4px;">{cf.day}{cf.slot} {cf.name}</span>
      {/each}
    </div>
  {/if}

  {#if course.xkTextNote}
    <div style="font-size:11px;color:var(--nx-amber);margin-top:4px;padding:3px 8px;background:rgba(255,159,26,.06);border-radius:4px;line-height:1.4;">
      {course.xkTextNote}
    </div>
  {/if}

  <div class="flex items-center gap-1.5 flex-wrap" style="margin-top:6px;">
    <button
      type="button"
      class="nx-ghost-btn"
      style="font-size:11px;padding:3px 10px;"
      onclick={(e) => {
        e.stopPropagation();
        openWindow({ kind: 'course', code: course.code, teacherId: course.teacherId || '' });
      }}
    >简介</button
    >
    {#if course.selected}
      <span style="font-size:11px;color:var(--nx-ink-soft);">第{course.zy}志愿 · {course.typeLabel || ''}</span>
      {#if !session.isQueuePhase}
        <span style="font-size:11px;font-weight:700;color:{meta.color};">{meta.prob >= 0 ? meta.percentLabel : meta.label}</span>
      {/if}
      <button
        type="button"
        class="nx-vol-btn"
        disabled={!(course.zy && course.zy > 1 && canAdj(course.zy - 1))}
        title={course.zy && course.zy > 1 ? (canAdj(course.zy - 1) ? '升为第' + (course.zy - 1) + '志愿' : '该志愿名额已满') : ''}
        onclick={(e) => {
          e.stopPropagation();
          void onVolChange('up');
        }}
      >▲</button
      >
      <button
        type="button"
        class="nx-vol-btn"
        disabled={!(course.zy && course.zy < 3 && canAdj(course.zy + 1))}
        title={course.zy && course.zy < 3 ? (canAdj(course.zy + 1) ? '降为第' + (course.zy + 1) + '志愿' : '该志愿名额已满') : ''}
        onclick={(e) => {
          e.stopPropagation();
          void onVolChange('down');
        }}
      >▼</button
      >
      <button
        type="button"
        class="nx-stage-btn"
        onclick={(e) => {
          e.stopPropagation();
          onAddDraft();
        }}
      >加入草稿</button
      >
      <button
        type="button"
        class="nx-drop-btn"
        disabled={busy}
        onclick={(e) => {
          e.stopPropagation();
          void onDrop();
        }}
      >{course.isCandidate ? '退队' : '退选'}</button
      >
    {:else}
      <select class="nx-type-select" value={selFlag} onchange={(e) => (selFlag = (e.currentTarget as HTMLSelectElement).value)}>
        {#each allowedFlags(baseFlag(course)) as f}
          <option value={f}>{flagName(f)}</option>
        {/each}
      </select>
      <select class="nx-zy-select" value={String(selZy)} onchange={(e) => (selZy = parseInt((e.currentTarget as HTMLSelectElement).value) || 3)}>
        <option value="3">3志愿</option>
        <option value="2">2志愿</option>
        <option value="1">1志愿</option>
      </select>
      {#if session.isQueuePhase}
        <span style="font-size:11px;font-weight:700;color:{cand ? '#ff9f1a' : qd && qd.qRemaining > 0 ? '#07c160' : '#ee4d4d'};">{queueInfo() || '已满'}</span>
      {:else}
        <span style="font-size:11px;font-weight:700;color:{meta.color};">{meta.prob >= 0 ? meta.percentLabel : meta.label}</span>
      {/if}
      <button class="nx-select-btn" disabled={busy} onclick={(e) => { e.stopPropagation(); onAddDraft(); }}>
        加入草稿
      </button>
    {/if}
  </div>

  <div class="nx-card-detail">
    <div style="font-size:11px;color:var(--nx-faint);margin-top:6px;">
      {course.capacity ? '容量' + course.capacity : ''}
      {course.remaining !== undefined && course.remaining !== null ? ' · 余' + course.remaining : ''}
    </div>
  </div>
</div>

