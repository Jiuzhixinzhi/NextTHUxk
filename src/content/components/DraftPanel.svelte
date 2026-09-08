<script lang="ts">
  import { draftStore, MAX_DRAFTS, ensureActiveDraft, updateActiveCourse, removeActiveCourse, createDraft, setActive, toggleExpand, deleteDraft, renameDraft, loadSelectedIntoActive, importJson, copyExport, promote, setPreview, updateDraftCourse, removeDraftCourse, activeDraftNow } from '../../lib/stores/drafts.svelte.ts';

  const activeDraft = $derived.by(() => activeDraftNow());
  import { detectConflicts } from '../../lib/domain/conflict';
  import { session } from '../../lib/stores/session.svelte.ts';
  import { showToast } from '../../lib/stores/toast.svelte.ts';
  import { openWindow } from '../../lib/stores/modal.svelte.ts';
  import DraftCourseRow from './DraftCourseRow.svelte';
  import type { Flag } from '../../lib/domain/types';

  let importOpen = $state(false);
  let importText = $state('');

  const activeConflicts = $derived.by(() => {
    const d = activeDraft;
    if (!d) return [];
    return detectConflicts(d.courses as never, session.manualEvents);
  });

  function onPromote() {
    const d = activeDraft;
    if (!d) return;
    void promote(d);
  }

  function onNewDraft() {
    void createDraft();
  }

  function onLoadSelected() {
    const res = loadSelectedIntoActive();
    showToast(res.ok, res.msg);
  }

  function onImport() {
    if (importText.trim()) {
      const res = importJson(importText);
      showToast(res.ok, res.msg);
      if (res.ok) {
        importOpen = false;
        importText = '';
      }
    }
  }

  function onExport() {
    const d = ensureActiveDraft();
    void copyExport(d);
  }

  function creditsOf(): number {
    return (activeDraft?.courses || []).reduce((s, c) => s + (c.credits || 0), 0);
  }

  function goSim(courses: ReturnType<typeof getActiveCourses> = []) {
    if (!courses || !courses.length) {
      showToast(false, '草稿没有课程');
      return;
    }
    openWindow({ kind: 'creditSim', courses, title: '学分中签模拟' });
  }

  function getActiveCourses() {
    return activeDraft?.courses || [];
  }
</script>

<div class="nx-sec">
  <div class="nx-sec-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
    <span>草稿</span>
    <span style="font-size:10.5px;color:var(--nx-faint);font-weight:400;">
      {draftStore.drafts.length}/{MAX_DRAFTS} 份 · 活跃：{activeDraft ? '「' + activeDraft.name + '」' : '无'}
    </span>
    <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;">
      <button class="nx-stage-btn" onclick={onNewDraft}>新建草稿</button>
      <button class="nx-stage-btn" title="把当前已选整表并入活跃草稿，以现有课表为底稿继续编排" onclick={onLoadSelected}>已选载入</button>
      <button class="nx-stage-btn" onclick={onExport}>导出</button>
      <button class="nx-stage-btn" onclick={() => (importOpen = !importOpen)}>导入</button>
    </span>
  </div>

  {#if importOpen}
    <div style="margin-top:6px;">
      <textarea class="nx-inp" style="width:100%;font-size:11px;min-height:56px;" placeholder="粘贴导出的课表数据…" bind:value={importText}></textarea>
      <div style="display:flex;gap:6px;margin-top:4px;">
        <button class="nx-stage-btn" onclick={onImport}>确认导入到草稿「{activeDraft?.name || ''}」</button>
        <button class="nx-stage-btn" style="color:#ee4d4d;border-color:rgba(238,77,77,.3);" onclick={() => (importOpen = false)}>取消</button>
      </div>
    </div>
  {/if}

  {#if activeDraft}
    <div style="margin-top:8px;">
      <div class="flex items-center gap-2 flex-wrap">
        <span style="font-size:12.5px;font-weight:700;">{activeDraft.name}</span>
        <span style="font-size:10.5px;color:var(--nx-faint);">{activeDraft.courses.length}门 · {creditsOf()}学分 · 可直接编辑（改动自动保存）</span>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">
        <button class="nx-stage-btn" onclick={onPromote}>提交选课</button>
        <button class="nx-stage-btn" onclick={() => goSim()}>学分模拟</button>
        <button class="nx-stage-btn" onclick={() => setPreview({ kind: 'draft', id: activeDraft!.id })}>预览</button>
        <button class="nx-stage-btn" onclick={() => void renameDraft(activeDraft!.id)}>重命名</button>
        <button class="nx-stage-btn" onclick={() => void deleteDraft(activeDraft!.id)}>删除</button>
        <button class="nx-stage-btn" onclick={() => setPreview({ kind: 'selected' })}>回看当前已选</button>
      </div>

      {#if activeDraft.courses.length}
        <div style="margin-top:6px;">
          {#each activeDraft.courses as c, ci (c.code + '_' + (c.seq || '0'))}
            <DraftCourseRow
              course={c}
              onFlag={(f: Flag) => updateActiveCourse(ci, { flag: f })}
              onZy={(z) => updateActiveCourse(ci, { zy: z })}
              onRemove={() => removeActiveCourse(ci)}
            />
          {/each}
        </div>
      {:else}
        <div class="nx-st" style="margin-top:6px;">空草稿——点左侧课程卡片「加入草稿」，或用「已选载入」/「导入」添加；添加时会自动阻止时间冲突</div>
      {/if}

      <div style="margin-top:6px;font-size:11px;">
        {#if activeConflicts.length}
          {#each activeConflicts as cfl}
            <div style="color:#ee4d4d;line-height:1.6;">时间冲突：{cfl.day} {cfl.slot} — {cfl.a} 与 {cfl.b}</div>
          {/each}
          <div style="color:var(--nx-faint);font-size:10px;margin-top:2px;">导入/载入数据可能含冲突；课程卡片「加入草稿」已阻止新增冲突</div>
        {:else}
          <div style="color:#07c160;">✓ 无时间冲突</div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="nx-st" style="margin-top:8px;">还没有草稿——点「新建草稿」，或直接在课程卡片上「加入草稿」（自动创建）</div>
  {/if}

  <div style="margin-top:10px;">
    {#each draftStore.drafts as d (d.id)}
      {#if d.id !== draftStore.activeId}
        <div class="nx-draft-card">
          <div class="nx-draft-head" style="cursor:pointer;" onclick={() => toggleExpand(d.id)}>
            <span class="nx-draft-name">{draftStore.expandedId === d.id ? '▼' : '▶'} {d.name}</span>
            <span class="nx-draft-info">
              {d.courses.length}门 · {d.courses.reduce((s2, c) => s2 + (c.credits || 0), 0)}学分 · {new Date(d.createdAt).getMonth() + 1}/{new Date(d.createdAt).getDate()}
            </span>
          </div>
          <div class="nx-draft-acts">
            <button class="nx-stage-btn" onclick={() => setActive(d.id)}>设为活跃</button>
            <button class="nx-stage-btn" onclick={() => openWindow({ kind: 'creditSim', courses: d.courses, title: '草稿「' + d.name + '」 · 学分中签模拟' })}>学分模拟</button>
            <button class="nx-stage-btn" onclick={() => setPreview({ kind: 'draft', id: d.id })}>预览</button>
            <button class="nx-stage-btn" onclick={() => void promote(d)}>提交选课</button>
            <button class="nx-stage-btn" onclick={() => void copyExport(d)}>导出</button>
            <button class="nx-stage-btn" onclick={() => void renameDraft(d.id)}>重命名</button>
            <button class="nx-stage-btn" onclick={() => void deleteDraft(d.id)}>删除</button>
          </div>
          {#if draftStore.expandedId === d.id && d.courses.length}
            <div style="margin-top:6px;border-top:1px solid rgba(0,0,0,.06);padding-top:6px;">
              {#each d.courses as c, ci (c.code + '_' + (c.seq || '0'))}
                <DraftCourseRow
                  course={c}
                  onFlag={(f: Flag) => updateDraftCourse(d.id, ci, { flag: f })}
                  onZy={(z) => updateDraftCourse(d.id, ci, { zy: z })}
                  onRemove={() => removeDraftCourse(d.id, ci)}
                />
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</div>
