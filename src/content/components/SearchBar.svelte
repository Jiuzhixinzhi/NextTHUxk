<script lang="ts">
  import { search, onInput, onEnter, clearQuery, hasText } from '../../lib/stores/search.svelte.ts';
  import { session } from '../../lib/stores/session.svelte.ts';
  import { lc } from '../../lib/core/utils';
  import { scoreLv } from '../../lib/domain/scores';
  import type { Course } from '../../lib/domain/types';

  let suggestOpen = $state(false);
  let items = $state<Course[]>([]);
  let idx = $state(-1);
  // 联想武装：仅用户真实键入激活；jumpTo/pick 等程序性改 q 不应弹出（课表点击定位场景）
  let suggestArmed = $state(false);
  let blurT: ReturnType<typeof setTimeout>;

  function scoreCourse(c: Course, q: string): number {
    const name = lc(c.name);
    const code = String(c.code || '');
    const teacher = lc(c.teacher);
    let sc = -1;
    if (name.startsWith(q)) sc = 100;
    else if (name.includes(q)) sc = 80;
    else if (q.length >= 3 && code.startsWith(q)) sc = 70;
    else if (teacher.startsWith(q)) sc = 60;
    else if (teacher.includes(q)) sc = 50;
    else if (code.includes(q) && q.length >= 3) sc = 40;
    if (sc < 0) return sc;
    const tb = c._tbRef;
    if (tb && tb.count) sc += Math.min((tb.avg * 2 * Math.min(tb.count, 20)) / 20, 5);
    const sr = c._scoreRef;
    if (sr) sc += Math.min(((sr.avg - 5) * 1.5 * Math.min(sr.count, 20)) / 20, 3);
    if (c.available) sc += 2;
    return sc;
  }

  $effect(() => {
    const q = search.q.trim().toLowerCase();
    if (!q || !suggestArmed) {
      hide();
      return;
    }
    const scored: [number, Course][] = [];
    for (const c of session.allCourses) {
      const s = scoreCourse(c, q);
      if (s > 0) scored.push([s, c]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const next = scored.slice(0, 8).map((x) => x[1]);
    const same = next.length === items.length && next.every((x, i) => x === items[i]);
    if (!same) items = next;
    idx = -1;
    suggestOpen = next.length > 0;
  });

  function hide() {
    suggestOpen = false;
    items = [];
    idx = -1;
    suggestArmed = false;
  }

  function pick(i: number) {
    const c = items[i];
    if (!c) return;
    search.q = c.name;
    hide();
    onEnter();
  }

  function hlParts(name: string, q: string) {
    const i = name.toLowerCase().indexOf(q);
    if (i < 0) return { before: name, hit: '', after: '' };
    return { before: name.slice(0, i), hit: name.slice(i, i + q.length), after: name.slice(i + q.length) };
  }

  function onKeydown(ev: KeyboardEvent) {
    if (suggestOpen && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      idx = ev.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      return;
    }
    if (ev.key === 'Enter') {
      if (suggestOpen && items.length) pick(idx >= 0 ? idx : 0);
      else onEnter();
      return;
    }
    if (ev.key === 'Escape') hide();
  }
</script>

<div class="relative" style="position:relative;">
  <div class="flex items-center rounded-xl" style="position:relative;">
    <input
      type="text"
      class="nx-search"
      placeholder="搜索课程名称、教师、课程号…"
      value={search.q}
      oninput={(e) => {
        onInput((e.currentTarget as HTMLInputElement).value);
        suggestArmed = true;
      }}
      onkeydown={onKeydown}
      onblur={() => {
        clearTimeout(blurT);
        blurT = setTimeout(hide, 150);
      }}
    />
    {#if hasText()}
      <button
        type="button"
        aria-label="清空搜索"
        onclick={() => {
          hide();
          clearQuery();
        }}
        style="position:absolute;right:10px;background:none;border:none;color:var(--nx-faint);font-size:16px;cursor:pointer;line-height:1;"
      >×</button
      >
    {/if}
  </div>
  {#if suggestOpen}
    <div
      class="nx-suggest show"
      style="position:absolute;top:42px;left:0;right:0;"
      onpointerdown={(e) => e.preventDefault()}
    >
      {#each items as c, i (i)}
        {@const h = hlParts(c.name, search.q.trim().toLowerCase())}
        <div
          class="nx-sg-item"
          style={i === idx ? 'background:rgba(47,107,255,.07);' : ''}
          onclick={() => pick(i)}
        >
          <span class="nx-sg-name">{h.before}<b>{h.hit}</b>{h.after}</span>
          <span class="nx-sg-meta">{c.teacher || ''}{c.teacher && c.department ? ' · ' : ''}{c.department || ''}</span>
          {#if c._scoreRef}
            <span class="nx-sg-score {scoreLv(c._scoreRef.avg)}">校评 {c._scoreRef.avg.toFixed(1)}</span>
            <span class="nx-sg-cnt">{c._scoreRef.count}人</span>
          {/if}
          {#if c._tbRef && c._tbRef.count}
            <span
              class="nx-sg-star {c._tbRef.avg >= 4.5 ? 'lv-hi' : c._tbRef.avg >= 4 ? 'lv-good' : c._tbRef.avg >= 3 ? 'lv-mid' : 'lv-bad'}"
            >★{Number(c._tbRef.avg).toFixed(1)}</span
            >
            <span class="nx-sg-cnt">{c._tbRef.count}评</span>
          {:else if !c._scoreRef}
            <span class="nx-sg-norev">无点评</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

