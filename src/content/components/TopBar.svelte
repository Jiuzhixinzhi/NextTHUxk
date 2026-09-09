<script lang="ts">
  import { BUILD, curVer } from '../../lib/core/constants';
  import { session, changeSemester, closeWorkbench } from '../../lib/stores/session.svelte.ts';
  import { fmtTime } from '../../lib/core/utils';
  import { vol } from '../../lib/stores/volunteer.svelte.ts';
  import { checkUpdate } from '../../lib/update/check';
  import { promptDialog } from '../../lib/stores/modal.svelte.ts';
  import { showToast } from '../../lib/stores/toast.svelte.ts';
  import { draftCounts, backupExport, backupImport } from '../../lib/stores/backup.svelte.ts';
  import { banner, setBanner } from '../../lib/stores/session.svelte.ts';

  let backupOpen = $state(false);
  let counts = $state({ drafts: 0, manual: 0, hist: 0 });
  let fileEl: HTMLInputElement;

  function cacheInfo(): string {
    const next = vol.nextSyncAt ? ' · 志愿按教务检查点(8/12/16/20点)同步，下次 ' + fmtTime(new Date(vol.nextSyncAt).valueOf()) : '';
    return session.isQueuePhase
      ? `课余量池内同步 ${Object.keys(session.queueDataMap).length} 门 · 候补 ${session.candidateCourses.length} 门 · 随时查询` + next
      : `随时查询模式 · 已选 ${session.allCourses.filter((c) => c.selected).length} 门 · 候补 ${session.candidateCourses.length} 门` + next;
  }

  async function onSemClick() {
    const s = await promptDialog('修改学期', session.SEM, '如 2026-2027-1');
    if (s && s.trim()) await changeSemester(s);
  }

  async function onCheckUpdate() {
    const { store } = await import('../../lib/storage/store');
    const K = (await import('../../lib/storage/store')).K;
    await store.set(K.lastUpdateCheck, 0);
    let found = false;
    await checkUpdate(
      {
        onDanger: () => {
          found = true;
          setBanner('danger');
        },
        onUpdate: (v, u) => {
          found = true;
          setBanner('update', v, u);
        },
      },
      false,
    );
    if (!found) showToast(true, '当前已是最新版本 v' + curVer());
  }

  async function onExport() {
    backupOpen = false;
    await countsRefresh();
    await backupExport();
  }

  async function onImportFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      await backupImport(await file.text());
    } catch (e) {
      showToast(false, '读取文件失败: ' + ((e as Error).message || String(e)));
    }
  }

  async function countsRefresh() {
    const c = await draftCounts();
    counts = { drafts: c.drafts, manual: c.manual, hist: c.hist };
  }

  function pickExport() {
    backupOpen = false;
    void countsRefresh().then(() => onExport());
  }
</script>

<div class="flex items-center justify-between shrink-0" style="padding:12px 20px;background:rgba(255,255,255,.55);backdrop-filter:var(--nx-lg-filter);-webkit-backdrop-filter:var(--nx-lg-filter);box-shadow:var(--nx-glass-edge),0 8px 32px rgba(28,39,64,.1);">
  <div class="flex items-center gap-3">
    <span class="othu-logo" style="font-size:14px">
      <span class="lp">(</span><span class="word"><i>O</i><i>n</i><i>e</i></span><span></span><span class="lp"> </span><span class="tu">T</span><span class="tu">H</span><span class="tu">U</span><span class="lp">)</span>
    </span>
    <span style="font-size:16px;font-weight:700;letter-spacing:.06em;">NextTHUxk</span>
    <span style="font-size:9px;color:rgba(31,35,41,.35);letter-spacing:.5px;">{BUILD}</span>
    {#if session.isQueuePhase}
      <span style="font-size:11px;background:rgba(47,107,255,.1);color:var(--nx-accent);padding:2px 8px;border-radius:4px;">课余量模式</span>
    {/if}
  </div>
  <div class="flex items-center gap-2">
    <span style="font-size:11px;color:var(--nx-ink-soft);">{cacheInfo()}</span>
    <button class="nx-ghost-btn" title="点击修改学期" onclick={onSemClick}>{session.SEM || '设置学期'}</button>
    <button class="nx-ghost-btn" onclick={onCheckUpdate}>检查更新</button>
    <div class="relative" style="position:relative;">
      <button
        class="nx-ghost-btn"
        onclick={(ev) => {
          ev.stopPropagation();
          backupOpen = !backupOpen;
          void countsRefresh();
        }}
      >备份</button
      >
      {#if backupOpen}
        <div class="absolute right-0 top-full mt-2 min-w-60 flex-col gap-0.5 p-2" style="position:absolute;top:36px;right:0;min-width:240px;background:var(--nx-glass-strong);backdrop-filter:var(--nx-glass-blur-strong);-webkit-backdrop-filter:var(--nx-glass-blur-strong);box-shadow:var(--nx-lg-edge),0 16px 48px rgba(16,20,32,.22);border-radius:14px;z-index:60;display:flex;flex-direction:column;gap:2px;">
          <div style="font-size:11px;color:var(--nx-faint);padding:4px 10px 6px;">草稿 {counts.drafts} 份 · 占用 {counts.manual} 条{counts.hist ? ` · 趋势历史 ${counts.hist} 课` : ''}</div>
          <button class="nx-bm-item" type="button" onclick={pickExport}>导出备份（.json）</button>
          <button class="nx-bm-item" type="button" onclick={() => { backupOpen = false; fileEl?.click(); }}>导入备份</button>
          <div style="font-size:10px;color:var(--nx-faint);padding:4px 10px;border-top:1px solid var(--nx-line);margin-top:4px;">导入按课班 / 草稿名智能合并，不覆盖现有数据；备份文件含草稿、自定义占用与概率缓存（趋势历史 + 当前窗口志愿）</div>
        </div>
      {/if}
    </div>
    <input
      bind:this={fileEl}
      type="file"
      accept=".json,application/json"
      style="display:none"
      onchange={onImportFile}
    />
    <button class="nx-ghost-btn" onclick={closeWorkbench}>返回原系统</button>
  </div>
</div>

