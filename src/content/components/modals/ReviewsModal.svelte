<script lang="ts">
  import { session } from '../../../lib/stores/session.svelte.ts';
  import { ensureIndex, tbMatch, tbFetchReviews, tbCourseUrl, tbWriteUrl, tbStars } from '../../../lib/reviews/reviews';
  import { keyOf } from '../../../lib/core/utils';
  import type { TbEntry } from '../../../lib/domain/types';

  let { code, seq }: { code: string; seq: string } = $props();

  const reviews = $state({
    loading: true,
    entry: null as TbEntry | null,
    results: null as { rating: number; score?: string; created_at?: string; comment?: string }[] | null,
    error: '',
  });

  $effect(() => {
    const c0 = code;
    const s0 = seq;
    void (async () => {
      reviews.loading = true;
      reviews.results = null;
      reviews.error = '';
      reviews.entry = null;
      const c = session.allCourses.find((x) => keyOf(x.code, x.seq) === keyOf(c0, s0)) || session.candidateCourses.find((x) => x.code === c0);
      await ensureIndex().catch(() => {});
      try {
        reviews.entry = c ? tbMatch(c) : null;
      } catch {
        /* ignored */
      }
      const e = reviews.entry;
      if (e) {
        try {
          const data = await tbFetchReviews(e.sqid);
          reviews.results = data.results as never;
        } catch {
          reviews.error = '点评加载失败（网络原因），稍后重试';
        }
      }
      reviews.loading = false;
    })();
  });
</script>

{#if reviews.loading}
  <div class="nx-modal-loading"><span class="nx-spin"></span> 正在加载点评…</div>
{:else}
  {#if reviews.entry}
    <div class="nx-tb-head">
      <span class="nx-tb-avg">{Number(reviews.entry.avg).toFixed(1)}</span>
      <span class="nx-tb-starsline">
        <span class="nx-tb-stars">{tbStars(reviews.entry.avg)}</span>
        <span class="nx-tb-cnt">{reviews.entry.count} 条点评{reviews.entry.kkdw ? ' · ' + reviews.entry.kkdw : ''}</span>
      </span>
    </div>
  {:else}
    <div class="nx-tb-head nx-tb-empty">这门课在 THU选课社区还没有点评</div>
  {/if}
  <div class="nx-tb-actions-row">
    <a class="nx-tb-link" href={tbCourseUrl(reviews.entry)} target="_blank" rel="noopener noreferrer">查看课程页 ↗</a>
    <a class="nx-tb-link nx-tb-link-primary" href={tbWriteUrl(reviews.entry)} target="_blank" rel="noopener noreferrer">✎ 去写点评</a>
  </div>
  <div class="nx-tb-license">
    点评数据来自 <a href={tbCourseUrl(reviews.entry)} target="_blank" rel="noopener noreferrer">THU选课社区</a> 贡献者，以
    <a href="https://creativecommons.org/licenses/by-nc/4.0/deed.zh" target="_blank" rel="noopener noreferrer">CC BY-NC 4.0</a> 提供 · 仅限非商业用途
  </div>
  {#if reviews.error}
    <div class="nx-modal-loading">{reviews.error}</div>
  {:else if reviews.results === null}
    <div class="nx-modal-loading"><span class="nx-spin"></span> 拉取正文…</div>
  {:else if reviews.results.length === 0}
    <div class="nx-modal-loading">暂无点评正文</div>
  {:else}
    {#each reviews.results as r, i (i)}
      <div class="nx-tb-item">
        <div class="nx-tb-item-head">
          <span class="nx-tb-stars">{tbStars(r.rating)}</span>
          <span class="nx-tb-score">{Number(r.rating || 0)}</span>
          {#if r.score}<span class="nx-tb-grade">给分 {String(r.score).slice(0, 8)}</span>{/if}
          <span class="nx-tb-date">{r.created_at || ''}</span>
        </div>
        <div class="nx-tb-text">{(r.comment || '').trim()}</div>
      </div>
    {/each}
  {/if}
{/if}
