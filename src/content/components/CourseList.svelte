<script lang="ts">
  import { search as st, gotoPage, browseGoto, loadAll, runServerQuery, getDisplayed, getVisibleRows, getPager, isSearchMode, isLocalFiltersActive } from '../../lib/stores/search.svelte.ts';
  import { session } from '../../lib/stores/session.svelte.ts';
  import CourseCard from './CourseCard.svelte';
  import PlanView from './PlanView.svelte';

  const searchMode = $derived.by(() => isSearchMode());
  const localFiltersActive = $derived.by(() => isLocalFiltersActive());
  const displayed = $derived.by(() => getDisplayed());
  const visibleRows = $derived.by(() => getVisibleRows());
  const pagerInfo = $derived.by(() => getPager());

  let listEl: HTMLDivElement;
  let consumedSeq = 0;

  $effect(() => {
    const seq = st.scrollSeq;
    if (!seq || seq === consumedSeq) return;
    consumedSeq = seq;
    const el = listEl;
    if (!el) return;
    const code = st.lastHit.code;
    const sq = st.lastHit.seq;
    const t = el.querySelector<HTMLElement>(`.nx-card-holder[data-code="${code}"][data-seq="${sq}"]`);
    if (t) {
      t.scrollIntoView({ behavior: 'smooth', block: 'center' });
      t.querySelector('.nx-card')?.classList.add('nx-jump-target');
      setTimeout(() => t.querySelector('.nx-card')?.classList.remove('nx-jump-target'), 1800);
    }
  });

  function pagerText(): string {
    const p = pagerInfo;
    if (!searchMode) {
      return (
        '第 ' + p.curPage + ' 页' +
        (p.totalPages > 0 ? ' / 共 ' + p.totalPages + ' 页' : '') +
        (p.totalRows > 0 ? '（共 ' + p.totalRows + ' 条记录）' : ' · 随时查询')
      );
    }
    if (localFiltersActive) return '第 ' + p.curPage + ' 页 / 共 ' + p.totalPages + ' 页（当前条件 ' + p.count + ' 条）';
    return '第 ' + p.curPage + ' 页 / 共 ' + p.totalPages + ' 页' + (p.incomplete ? '' : p.totalRows > 0 ? '（' + p.totalRows + ' 条记录）' : '');
  }

  function pageGo(dir: number) {
    const p = pagerInfo;
    const next = dir < 0 ? p.curPage - 1 : p.curPage + 1;
    if (next < 1) return;
    if (searchMode) gotoPage(next);
    else browseGoto(next);
  }

  function pageDisabled(next: boolean): boolean {
    const p = pagerInfo;
    if (!searchMode) return next ? !st.browseHasMore && !(p.totalPages > p.curPage) : p.curPage <= 1;
    return next ? p.curPage >= p.totalPages : p.curPage <= 1;
  }
</script>

<div class="flex-1 min-h-0 overflow-y-auto" style="padding:4px 16px 40px;">
  {#if st.chip === 'plan'}
    <PlanView />
  {:else if st.searching && !st.rows}
    <div class="nx-empty"><span class="nx-spin"></span>&ensp;正在查询教务（服务器精确匹配 · 随时查询模式）…</div>
  {:else if st.error && !displayed.length}
    <div class="nx-empty nx-st err">{st.error}</div>
    <div style="text-align:center;padding:6px 0 2px;">
      <button type="button" class="nx-stage-btn" onclick={() => void runServerQuery()}>重试</button>
    </div>
  {:else if visibleRows.length === 0}
    <div class="nx-empty">{searchMode ? '暂无匹配课程' : '暂无课程'}</div>
  {:else}
    <div bind:this={listEl}>
      {#each visibleRows as c (c.code + '_' + (c.seq || '0'))}
        <div class="nx-card-holder" data-code={c.code} data-seq={c.seq || '0'}>
          <CourseCard course={c} />
        </div>
      {/each}
    </div>
  {/if}

  {#if searchMode && st.incomplete && visibleRows.length}
    <div class="nx-st" style="display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 0 2px;font-size:11px;color:#b8860b;">
      数据不完整：已加载 {displayed.length} 门{st.totalPages > 0 ? '，教务共 ' + st.totalPages + ' 页' : ''}{st.totalRows > 0 ? '（共 ' + st.totalRows + ' 门）' : ''}
      <button type="button" class="nx-stage-btn" style="margin-left:6px;" disabled={st.loadingAll} onclick={() => loadAll()}>
        {st.loadingAll ? '加载中…' : '加载当前关键词全部'}
      </button>
    </div>
  {/if}

  {#if session.open && st.rows !== null}
    <div class="flex flex-wrap" style="gap:8px;justify-content:center;align-items:center;padding:10px 0 4px;">
      <button class="nx-stage-btn" disabled={pageDisabled(false)} onclick={() => pageGo(-1)}>‹ 上一页</button>
      <span style="font-size:11px;color:var(--nx-faint);">{st.rows === null ? '' : pagerText()}</span>
      <button class="nx-stage-btn" disabled={pageDisabled(true)} onclick={() => pageGo(1)}>下一页 ›</button>
    </div>
  {/if}
</div>
