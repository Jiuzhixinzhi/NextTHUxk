<script lang="ts">
  import type { Course } from '../../lib/domain/types';
  import { session, doDropCourse } from '../../lib/stores/session.svelte.ts';
  import { addCourseToActive } from '../../lib/stores/drafts.svelte.ts';
  import { jumpTo } from '../../lib/stores/search.svelte.ts';
  import { confirmDialog } from '../../lib/stores/modal.svelte.ts';
  import { showToast } from '../../lib/stores/toast.svelte.ts';
  import { entryBaseFlag } from '../../lib/domain/flags';
  import { keyOf } from '../../lib/core/utils';

  async function onDrop(code: string, seq: string) {
    const c = session.candidateCourses.find((x) => keyOf(x.code, x.seq) === keyOf(code, seq));
    if (!(await confirmDialog('退出候补队列「' + (c?.name || code) + '」？', ''))) return;
    const res = await doDropCourse(code, seq);
    showToast(res.ok, res.msg);
  }

  /** 暂存到活跃草稿：类型/志愿取候补行真值（上游 PR #53 暂存按钮同款） */
  function onStage(c: Course) {
    const res = addCourseToActive(c, entryBaseFlag(c), c.zy || 3);
    showToast(res.ok, res.msg);
  }
</script>

{#if session.candidateCourses.length}
  <div class="nx-sec">
    <div class="nx-sec-title">
      候选队列 <span style="font-size:11px;color:var(--nx-amber);font-weight:400;">{session.candidateCourses.length} 门</span>
    </div>
    {#each session.candidateCourses as c, i (keyOf(c.code, c.seq) + '_' + i)}
      <div class="nx-stage-item" style="flex-direction:column;align-items:stretch;gap:2px;">
        <div class="flex items-center gap-1.5">
          <span
            class="nx-stage-name"
            style="flex:1;cursor:pointer;"
            title="点击按课号搜索此课程"
            onclick={() => jumpTo(c.code, c.seq || '0', c.teacher)}
          >{c.name} <span style="color:var(--nx-faint);font-weight:400;font-size:11px;">{c.code}</span></span
          >
          <span style="font-size:11px;color:var(--nx-amber);font-weight:600;white-space:nowrap;">
            {c.myPos ? '排队第' + c.myPos + ' / 共' + (c.queueTotal || '?') + '人' : '候选中'}
          </span>
          <button
            style="height:22px;padding:0 10px;font-size:11px;border-radius:6px;border:1px solid rgba(7,193,96,.35);background:rgba(7,193,96,.1);color:#07c160;cursor:pointer;font-family:inherit;white-space:nowrap;"
            title="暂存到活跃草稿（不改动教务侧选课）"
            onclick={() => onStage(c)}
          >暂存</button
          >
          <button
            class="nx-drop-btn"
            style="height:22px;padding:0 10px;font-size:11px;"
            title="退出候补队列"
            onclick={() => void onDrop(c.code, c.seq)}
          >退队</button
          >
        </div>
        <div style="font-size:11px;color:var(--nx-ink-soft);">
          {[c.time, c.teacher, c.typeLabel].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
    {/each}
  </div>
{/if}
