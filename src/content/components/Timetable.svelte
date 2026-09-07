<script lang="ts">
  import { draftStore, setPreview, removeActiveCourse, previewRowsNow } from '../../lib/stores/drafts.svelte.ts';

  const previewRows = $derived.by(() => previewRowsNow());
  import { session, removeManualEvent, backfillSelTimes, resetBfBudget, doDropCourse } from '../../lib/stores/session.svelte.ts';
  import { search, jumpTo } from '../../lib/stores/search.svelte.ts';
  import { layoutPreview, axisHours, dayNames, type PreviewBlock } from '../../lib/domain/timetable-layout';
  import { calcProb, probBg } from '../../lib/domain/probability';
  import { typeCodeToFlag } from '../../lib/domain/flags';
  import { hm, ORIGIN_COLORS } from '../../lib/domain/time';
  import { previewBlockMeta } from '../../lib/domain/preview';
  import { openWindow, confirmDialog } from '../../lib/stores/modal.svelte.ts';
  import { showToast } from '../../lib/stores/toast.svelte.ts';
  import { keyOf } from '../../lib/core/utils';
  import type { Course, ManualEvent } from '../../lib/domain/types';

  const layout = $derived.by(() => {
    return layoutPreview(previewRows as (Course | ManualEvent)[], (c) => {
      const manual = (c as ManualEvent).manual === true;
      if (manual) return { color: '#8b5cf6', probLabel: '自定义', bg: 'rgba(139,92,246,.14)' };
      const cc = c as Course;
      const isSelectedView = draftStore.preview.kind === 'selected';
      let prob: { color: string; label: string; bg: string } | null = null;
      if (!session.isQueuePhase) {
        if (isSelectedView && cc.zy) {
          const p = calcProb(cc, typeCodeToFlag(cc.typeCode), cc.zy);
          if (p.prob >= 0) prob = { color: p.color, label: p.percentLabel || p.label, bg: probBg(p.color) };
        } else if (!isSelectedView && cc.flag && cc.zy) {
          const ac = session.allCourses.find((x) => keyOf(x.code, x.seq) === keyOf(cc.code, cc.seq));
          if (ac) {
            const p = calcProb(ac, cc.flag, cc.zy);
            if (p.prob >= 0) prob = { color: p.color, label: p.percentLabel || p.label, bg: probBg(p.color) };
          }
        }
      }
      const cand = session.candidateCourses.find((x) => keyOf(x.code, x.seq) === keyOf(cc.code, cc.seq));
      const qd = session.queueDataMap[keyOf(cc.code, cc.seq)];
      const qdArg = qd ? { qRemaining: qd.qRemaining, qQueue: qd.qQueue, qCapacity: qd.qCapacity } : {};
      const meta = previewBlockMeta(cc, session.isQueuePhase, isSelectedView, qdArg as Record<string, { qRemaining: number; qQueue: number; qCapacity: number }>, cand, prob);
      return { color: meta.color, probLabel: meta.label, bg: meta.bg };
    });
  });

  const previewLabel = $derived((() => {
    const p = draftStore.preview;
    if (p.kind === 'selected') return '当前已选';
    const d = draftStore.drafts.find((x) => x.id === p.id);
    return d ? '草稿「' + d.name + '」' + (d.id === draftStore.activeId ? ' · 活跃' : '') : '当前已选';
  })());

  function onBlockClick(b: PreviewBlock) {
    if (b.manual) return;
    if (b.code) jumpTo(b.code, b.seq || '0');
  }

  async function onBlockRemove(b: PreviewBlock) {
    if (b.manual) {
      await removeManualEvent(b.id!);
      return;
    }
    if (draftStore.preview.kind === 'selected') {
      const c = session.allCourses.find((x) => keyOf(x.code, x.seq) === keyOf(b.code || '', b.seq || '0'));
      if (!(await confirmDialog('确认退选「' + (c?.name || b.label) + '」？', ''))) return;
      const res = await doDropCourse(b.code!, b.seq || '0');
      showToast(res.ok, res.msg);
      return;
    }
    const idx = previewRows.findIndex((x) => x.code === b.code && String(x.seq || '0') === String(b.seq || '0'));
    if (idx >= 0) removeActiveCourse(idx);
  }

  const summary = $derived((() => {
    const total = previewRows.reduce((s, c) => s + (c.credits || 0), 0);
    return previewRows.length + '门课 · ' + total + '学分' + (session.manualEvents.length ? ' · 自定义占用' + session.manualEvents.length + '项' : '');
  })());

  function onRetry() {
    resetBfBudget();
    void backfillSelTimes();
  }

  function undetClick(u: { manual: boolean; code: string; seq: string; id?: number }) {
    if (u.manual) {
      void removeManualEvent(u.id!);
      return;
    }
    if (draftStore.preview.kind !== 'selected') {
      const idx = previewRows.findIndex((x) => x.code === u.code && String(x.seq || '0') === String(u.seq));
      if (idx >= 0) removeActiveCourse(idx);
    } else {
      jumpTo(u.code, u.seq);
    }
  }

  function originColorOf(b: PreviewBlock): string {
    return ORIGIN_COLORS[b.origin] || '#666';
  }

  void search;
</script>

<div class="nx-sec">
  <div class="nx-sec-title">
    <div class="flex items-center gap-2" style="flex:1;min-width:0;">
      <span style="white-space:nowrap;">课表预览</span>
      <span style="font-size:11px;color:var(--nx-ink-soft);font-weight:400;">{previewLabel}</span>
    </div>
    <button class="nx-stage-btn" onclick={() => openWindow({ kind: 'manualEvent' })}>＋ 添加占用</button>
  </div>

  <div class="flex gap-1.5 flex-wrap" style="margin-bottom:8px;">
    <button class="nx-chip" class:on={draftStore.preview.kind === 'selected'} onclick={() => setPreview({ kind: 'selected' })}>当前已选</button>
    {#if draftStore.drafts.length}
      <button
        class="nx-chip"
        class:on={draftStore.preview.kind === 'draft' && draftStore.preview.id === draftStore.activeId}
        onclick={() => setPreview({ kind: 'draft', id: draftStore.activeId })}
      >活跃草稿</button
      >
      {#each draftStore.drafts.filter((d) => d.id !== draftStore.activeId) as active_ (active_.id)}
        <button
          class="nx-chip"
          class:on={draftStore.preview.kind === 'draft' && draftStore.preview.id === active_.id}
          onclick={() => setPreview({ kind: 'draft', id: active_.id })}
        >{active_.name}</button
        >
      {/each}
    {/if}
  </div>

  {#if !layout.blocks.length && !layout.undet.length && !session.manualEvents.length}
    <div class="nx-st">选课后自动生成预览；无固定时段的课程列在下方</div>
  {:else}
    <div class="nx-tta">
      <div class="nx-tta-axis" style="height:{layout.H}px;">
        {#each axisHours(layout.A0, layout.A1) as h (h.top)}
          <span class="nx-tta-hl" style="top:{h.top}px;">{h.label}</span>
        {/each}
      </div>
      {#each dayNames as dn, di}
        <div class="nx-tta-day">
          <div class="nx-tta-day-h">{dn}</div>
          <div class="nx-tta-day-b" style="height:{layout.H}px;">
            {#each layout.blocks.filter((b) => b.day === di + 1) as b (b.key + '_' + b.begin + '_' + b.end)}
              <div
                class:manual={b.manual}
                class="nx-tta-b"
                style="top:{Math.round((b.begin - layout.A0) * 0.72)}px;height:{Math.max(14, Math.round((b.end - b.begin) * 0.72) - 2)}px;left:calc({b.lane * 100 / b.lanes}% + 1px);width:calc({100 / b.lanes}% - 2px);background:{b.bg || b.color + '22'};border-left:3px solid {b.color};"
                title={b.title}
                onclick={() => onBlockClick(b)}
              >
                <div class="nx-tta-l">
                  {#if b.origin}
                    <span class="nx-tta-origin" style="background:{originColorOf(b)};">{b.origin}</span>
                  {/if}
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{b.label}</span>
                  {#if b.probLabel}
                    <span class="nx-tt-prob" style="background:{b.bg};color:{b.color};">{b.probLabel}</span>
                  {/if}
                  <span class="nx-tta-tag">{hm(b.begin)}-{hm(b.end)}</span>
                </div>
                <span
                  class="nx-tta-x"
                  title="移除"
                  onclick={(e) => {
                    e.stopPropagation();
                    void onBlockRemove(b);
                  }}
                >✕</span
                >
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    {#if layout.undet.length}
      <div style="margin-top:10px;font-size:11px;color:var(--nx-faint);">
        时间未定 / 无固定时段（{layout.undet.length} 门，不含在上方网格中）
        {#if draftStore.preview.kind === 'selected'}
          <button
            type="button"
            style="margin-left:8px;background:rgba(47,107,255,.12);border:none;color:var(--nx-accent);border-radius:4px;padding:1px 8px;cursor:pointer;font-size:10px;"
            onclick={onRetry}
          >重试解析</button
          >
        {/if}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
        {#each layout.undet as u, ui (u.code + '_' + u.seq + (u.manual ? 'm' : '') + '_' + ui)}
          <span class="nx-tt-undet" onclick={() => undetClick(u)} title="点击：手动占用=移除；草稿=移除；已选=定位搜索">
            {u.label} · {u.credits}学分 <i>✕</i>
          </span>
        {/each}
      </div>
    {/if}

    {#if session.manualEvents.length}
      <div class="nx-manual-list" style="margin-top:8px;">
        <span class="nx-manual-list-label">自定义占用</span>
        {#each session.manualEvents as e (e.id)}
          <button type="button" class="nx-manual-chip" title="删除此占用" onclick={() => void removeManualEvent(e.id)}>
            {e.name}{e.begin ? ' · 周' + '一二三四五六日'[Number(e.day) - 1] + ' ' + e.begin + '-' + e.end : ''}　✕
          </button>
        {/each}
      </div>
    {/if}

    <div class="nx-st ok" style="margin-top:6px;">{summary}</div>
  {/if}
</div>

