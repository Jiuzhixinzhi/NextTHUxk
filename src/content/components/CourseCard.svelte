<script lang="ts">
  import type { Course, Flag } from '../../lib/domain/types';
  import { allowedFlags, entryBaseFlag, flagName, typeCodeToFlag } from '../../lib/domain/flags';
  import { ORIGIN_COLORS } from '../../lib/domain/time';
  import { courseCardModel, type ChainNode } from '../../lib/domain/card-model';
  import { deptCodeFromCode, deptNameOf } from '../../lib/api/dept';
  import { scoreLv } from '../../lib/domain/scores';
  import { session, doChangeVolunteer, doSubmitCourse, dropCourseFlow } from '../../lib/stores/session.svelte.ts';
  import { addCourseToActive } from '../../lib/stores/drafts.svelte.ts';
  import { probHist } from '../../lib/stores/probhist.svelte.ts';
  import { showToast, showXkResult } from '../../lib/stores/toast.svelte.ts';
  import { confirmDialog, openWindow } from '../../lib/stores/modal.svelte.ts';
  import { cardExpanded, toggleCard } from '../../lib/stores/uicards.svelte.ts';
  import type { PreviewSpan } from '../../lib/domain/conflict';
  import { keyOf } from '../../lib/core/utils';

  let { course, conflictSpans }: { course: Course; conflictSpans: PreviewSpan[] } = $props();

  let busy = $state(false);
  let selFlag = $state<string>(entryBaseFlag(course));
  let selZy = $state<number>(3);
  let chainFull = $state(false);

  $effect(() => {
    // 等值守卫：仅在真正变化时写，消除「写→失效→重跑」振荡面
    const nf = course.selected ? typeCodeToFlag(course.typeCode) : selFlag;
    const nz = course.selected ? course.zy || 3 : selZy;
    if (nf !== selFlag) selFlag = nf;
    if (nz !== selZy) selZy = nz;
  });

  // ─── 视图模型：容量条/开课线/中签链/涨跌/折叠行数字/冲突摘要口径全在 domain/card-model ───
  const model = $derived.by(() =>
    courseCardModel({
      course,
      isQueuePhase: session.isQueuePhase,
      selFlag: selFlag as Flag,
      selZy,
      queueDataMap: session.queueDataMap,
      candidateCourses: session.candidateCourses,
      allCourses: session.allCourses,
      hist: probHist.map[keyOf(course.code, course.seq)],
      conflictSpans,
    }),
  );
  const meta = $derived(model.meta);
  const capText = $derived(model.capText);
  const openRisk = $derived(model.openRisk);
  const chain = $derived(model.chain);
  const cardDelta = $derived(model.delta);
  const miniNum = $derived(model.miniNum);
  const conflicts = $derived(model.conflicts);
  const conflictMini = $derived(model.conflictMini);
  const subText = $derived(model.subText);
  const origins = $derived(model.origins);
  const selZyDisp = $derived(model.selZyDisp);

  const scoreRef = $derived(course._scoreRef);

  // ─── 课号拆段：首位·院系码(蓝)·尾段（尾段末位承载学分：放大加粗） ───
  const codeParts = $derived.by(() => {
    const code = String(course.code || '');
    const dseg = deptCodeFromCode(code);
    const last = code.slice(-1);
    const creditLast = /^\d$/.test(code.slice(-1)) && (!course.credits || Number(course.credits) === Number(last));
    return { head: dseg ? code.slice(0, 1) : '', dept: dseg, body: (dseg ? code.slice(4) : code).slice(0, -1), last, creditLast };
  });

  /** 课号 chip 悬浮：附带开课院系名（课时内蓝段只表码，名反查进 tooltip） */
  const codeTitle = $derived.by(() => {
    const name = deptNameOf(String(course.code || ''));
    return name ? `${course.code} · ${name}` : course.code;
  });

  // ─── 渐进式披露：手动覆盖优先，自动规则兜底
  // （优先级：已选/候补 > 冲突一律折叠（红标明示课节+课名，压过开课线风险与 available）> 开课线风险/可用展开；
  //   available 两阶段统一：课余量按 qRemaining>0 回写，预选为搜索页未满标志） ───
  const cardKey = $derived(keyOf(course.code, course.seq));
  const autoOpen = $derived.by(() => {
    if (course.selected || course.isCandidate) return true;
    if (conflicts.length > 0) return false;
    if (openRisk != null) return true;
    return !!course.available;
  });
  const exp = $derived(cardExpanded(cardKey, autoOpen));

  /** 切换展开；收起时重置链行展开态，再展开不残留 */
  function toggleExp(): void {
    toggleCard(cardKey, autoOpen);
    if (!cardExpanded(cardKey, autoOpen)) chainFull = false;
  }

  /** 整卡点击切换展开；按钮/下拉/链接等交互元素不触发 */
  function onCardClick(ev: MouseEvent): void {
    if ((ev.target as HTMLElement).closest('button, select, a, input, option')) return;
    toggleExp();
  }

  /** 级联链完整渲染由操作行概率按钮（.nx-prob-btn）切换 chainFull 驱动 */

  function onAddDraft() {
    const res = addCourseToActive(course, selFlag as Flag, selZy);
    showToast(res.ok, res.msg);
  }

  async function onDrop() {
    busy = true;
    try {
      await dropCourseFlow(course.code, course.seq, course.name);
    } finally {
      busy = false;
    }
  }

  /** 直接正选：课满时走 submitCourse 内部二段 saveBksKcDl 自动入候补队列 */
  async function onSelect() {
    const queue = session.isQueuePhase && !course.available;
    if (
      !(await confirmDialog(
        `${queue ? '排队选' : '选'}「${course.name}」？`,
        `${course.seq ? course.seq + '课序 · ' : ''}${flagName(selFlag as Flag)} · 第${selZy}志愿 · 教务确认后生效。${queue ? '当前课班余量为 0，将进入候补队列。' : ''}`
      ))
    )
      return;
    busy = true;
    try {
      const res = await doSubmitCourse(course.code, course.seq, selZy, selFlag);
      showXkResult(res);
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
</script>

<div class:selected={course.selected} class="nx-card" class:mini={!exp} onclick={onCardClick}>
  {#snippet chainNode(node: ChainNode)}

    <button
      type="button"
      class="nx-chain-node {node.active ? 'active' : ''} {node.muted ? 'muted' : ''}"
      style="{node.muted ? '' : 'background:' + node.color + ';color:#fff;'}"
      title="{node.title}"
      onclick={() => {
        openWindow({ kind: 'probTrend', code: course.code, seq: course.seq, flag: node.flag, zy: node.zy });
      }}
    >{node.pct}</button
    >
  {/snippet}

  {#snippet probBtn()}
    {#if !session.isQueuePhase}
      <button
        type="button"
        class="nx-prob-btn"
        style="color:{meta.color};background:{meta.bg};"
        title={chainFull ? '收起全部类型×志愿概率' : '展开全部类型×志愿概率'}
        onclick={() => {
          if (chain.length) chainFull = !chainFull;
        }}
      >{meta.prob >= 0 ? meta.percentLabel : meta.label}{chain.length ? (chainFull ? ' ▴' : ' ▾') : ''}</button>
      {#if cardDelta !== null}
        <span class="nx-trend-delta {cardDelta > 0 ? 'up' : cardDelta < 0 ? 'down' : ''}" title="相对上一志愿检查点窗口">
          {cardDelta > 0 ? '▲ +' + cardDelta + '%' : cardDelta < 0 ? '▼ ' + cardDelta + '%' : '– 0%'}
        </span>
      {/if}
    {/if}
  {/snippet}

  {#snippet selTag()}
    {#if course.selected}
      <span class="nx-tag nx-tag-sel">已选</span>
    {:else if !course.available}
      <span class="nx-tag nx-tag-no">已满</span>
    {/if}
  {/snippet}
  {#if exp}
    <div class="flex items-center gap-2">
      <span class="nx-card-name">{course.name}</span>
      {#if course.code}
        <span class="nx-code" title="{codeTitle}">
          {#if codeParts.dept}
            <span class="nx-code-head">{codeParts.head}</span><span class="nx-code-dept">{codeParts.dept}</span>{codeParts.body}
          {:else}
            {codeParts.body}
          {/if}
          {#if codeParts.creditLast}
            <span class="nx-code-last" title={Number(course.credits) > 0 ? '课号末位即学分：' + course.credits + ' 学分' : undefined}>{codeParts.last}</span>
          {:else}
            {codeParts.last}
            {#if Number(course.credits) > 0}
              <span class="nx-code-sep"></span><span class="nx-code-credit" title="{course.credits}学分">{course.credits}学分</span>
            {/if}
          {/if}
        </span>
      {/if}
      <span class="nx-head-right">
        {#if scoreRef}
          <span
            class="nx-score-badge {scoreLv(scoreRef.avg)}"
            title="教务系统评教均分（7 分制，按授课教师匹配）· {scoreRef.count}人参评 · 数据截至上一学期"
          >校评 {scoreRef.avg.toFixed(1)}<i>{scoreRef.count}人</i></span>
        {/if}
        {#if course._tbRef && course._tbRef.count}
          <button
            type="button"
            class="nx-tb-badge {course._tbRef.avg >= 4.5 ? 'lv-hi' : course._tbRef.avg >= 4 ? 'lv-good' : course._tbRef.avg >= 3 ? 'lv-mid' : 'lv-bad'}"
            title="THU选课社区评分 · 点击查看全部点评"
            onclick={() => {
              openWindow({ kind: 'reviews', code: course.code, seq: course.seq });
            }}
          >★{Number(course._tbRef.avg).toFixed(1)}<i>{course._tbRef.count}评</i></button
          >
        {/if}
        <button type="button" class="nx-chev" title="收起" onclick={() => toggleExp()}>▾</button>
      </span>
    </div>

    <div class="flex flex-wrap gap-1 items-center">
      {#if origins}
        <span class="nx-tag" style="color:#fff;background:{ORIGIN_COLORS[origins] || '#666'};border:none;">{origins}</span>
      {/if}
      {@render selTag()}
      {#if subText}
        <span class="nx-tagline-soft" title="{course.time}">{subText}</span>
      {/if}
    </div>

    {#if capText}
      <div class="nx-cap-wrap">
        <div class="nx-cap" title="{(capText.title)}{openRisk ? ' · 未达开课线(仅' + openRisk.used + '人' + openRisk.label + ')' : ''}">
          <div class="nx-cap-fill" style="width:{capText.pct}%;background:{capText.color};"></div>
          <span class="nx-cap-txt">{capText.text}</span>
        </div>
        {#if openRisk}
          <span class="nx-cap-risk">未达开课线</span>
        {/if}
      </div>
    {/if}

    {#if conflicts.length > 0}
      <div class="nx-conflict">
        <span class="nx-conflict-label">时间冲突</span>
        {#each conflicts.slice(0, 3) as cf}
          <span class="nx-conflict-chip">{cf.day}{cf.slot} {cf.name}</span>
        {/each}
        {#if conflicts.length > 3}
          <span class="nx-conflict-more">+{conflicts.length - 3}</span>
        {/if}
      </div>
    {/if}

    {#if course.xkTextNote}
      <div style="font-size:11px;color:var(--nx-amber);padding:3px 8px;background:rgba(255,159,26,.06);border-radius:4px;line-height:1.4;">
        {course.xkTextNote}
      </div>
    {/if}

    {#if !session.isQueuePhase && chainFull && chain.length}
      <div class="nx-chain">
        {#each chain as node (node.key)}
          {@render chainNode(node)}
        {/each}
      </div>
    {/if}

    <div class="flex items-center gap-1.5 flex-wrap">
      <button
        type="button"
        class="nx-ghost-btn"
        style="font-size:11px;padding:3px 10px;"
        onclick={() => {
          openWindow({ kind: 'course', code: course.code, teacherId: course.teacherId || '' });
        }}
      >简介</button
      >
      {#if course.selected}
        {#if selZyDisp > 0}
          <span style="font-size:11px;color:var(--nx-ink-soft);">第{selZyDisp}志愿{course.typeLabel ? ' · ' + course.typeLabel : ''}</span>
        {:else if course.typeLabel}
          <span style="font-size:11px;color:var(--nx-ink-soft);">{course.typeLabel}</span>
        {/if}
        {@render probBtn()}
        <button
          type="button"
          class="nx-vol-btn"
          disabled={!model.zyUp}
          title={model.zyUpTitle}
          onclick={() => {
            void onVolChange('up');
          }}
        >▲</button
        >
        <button
          type="button"
          class="nx-vol-btn"
          disabled={!model.zyDown}
          title={model.zyDownTitle}
          onclick={() => {
            void onVolChange('down');
          }}
        >▼</button
        >
        <button
          type="button"
          class="nx-stage-btn"
          onclick={() => {
            onAddDraft();
          }}
        >加入草稿</button
        >
        <button
          type="button"
          class="nx-drop-btn"
          disabled={busy}
          onclick={() => {
            void onDrop();
          }}
        >{course.isCandidate ? '退队' : '退选'}</button
        >
      {:else}
        <select class="nx-type-select" value={selFlag} onchange={(e) => (selFlag = (e.currentTarget as HTMLSelectElement).value)}>
          {#each allowedFlags(entryBaseFlag(course)) as f}
            <option value={f}>{flagName(f)}</option>
          {/each}
        </select>
        <select class="nx-zy-select" value={String(selZy)} onchange={(e) => (selZy = parseInt((e.currentTarget as HTMLSelectElement).value) || 3)}>
          <option value="3">3志愿</option>
          <option value="2">2志愿</option>
          <option value="1">1志愿</option>
        </select>
        {@render probBtn()}
        <button class="nx-select-btn" disabled={busy} onclick={() => { void onSelect(); }}>
          {session.isQueuePhase && !course.available ? '排队选课' : '选课'}
        </button>
        <button class="nx-stage-btn" disabled={busy} onclick={() => { onAddDraft(); }}>
          加入草稿
        </button>
      {/if}
    </div>
  {:else}
    <div class="nx-mini-row">
      <span class="nx-mini-name" title="{course.name}">{course.name}</span>
      {@render selTag()}
      {#if conflictMini}
        <span class="nx-mini-conflict" title="{conflictMini.title}">{conflictMini.label}</span>
      {/if}
      {#if subText}
        <span class="nx-mini-sub" title="{subText}">{subText}</span>
      {/if}
      {#if course.xkTextNote}
        <span class="nx-mini-warn" title="{course.xkTextNote}">⚠</span>
      {/if}
      {#if miniNum}
        <span class="nx-mini-num" style="color:{miniNum.color};" title="{miniNum.title}">{miniNum.text}</span>
      {/if}
      <span class="nx-mini-actions">
        {#if course.selected}
          <button type="button" class="nx-stage-btn nx-mini-btn" onclick={() => { onAddDraft(); }}>＋草稿</button>
          <button type="button" class="nx-drop-btn nx-mini-btn" disabled={busy} onclick={() => { void onDrop(); }}>{course.isCandidate ? '退队' : '退选'}</button>
        {:else}
          <button type="button" class="nx-select-btn nx-mini-btn" disabled={busy} onclick={() => { void onSelect(); }}>
            {session.isQueuePhase && !course.available ? '排队选课' : '选课'}
          </button>
          <button type="button" class="nx-stage-btn nx-mini-btn" disabled={busy} onclick={() => { onAddDraft(); }}>＋草稿</button>
        {/if}
        <button type="button" class="nx-chev" title="展开详情" onclick={() => toggleExp()}>▸</button>
      </span>
    </div>
  {/if}
</div>
