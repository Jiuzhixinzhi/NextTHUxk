<script lang="ts">
  import type { Course, Flag } from '../../lib/domain/types';
  import { ZY_LIMITS } from '../../lib/core/constants';
  import { allowedFlags, baseFlag, canAdjustZy, flagName, typeCodeToFlag } from '../../lib/domain/flags';
  import { capacityStatus, cascadeOf, currentProbMeta, lockedOf, probGridData, volColor } from '../../lib/domain/probability';
  import { ORIGIN_COLORS, originOf, parseTimeSlots } from '../../lib/domain/time';
  import { deptCodeFromCode, deptNameOf } from '../../lib/api/dept';
  import { scoreLv } from '../../lib/domain/scores';
  import { session, doChangeVolunteer, doDropCourse, doSubmitCourse, selectedPreviewRows } from '../../lib/stores/session.svelte.ts';
  import { addCourseToActive } from '../../lib/stores/drafts.svelte.ts';
  import { probHist } from '../../lib/stores/probhist.svelte.ts';
  import { trendDelta } from '../../lib/domain/probhist';
  import { showToast, showXkResult } from '../../lib/stores/toast.svelte.ts';
  import { confirmDialog, openWindow } from '../../lib/stores/modal.svelte.ts';
  import { cardExpanded, toggleCard } from '../../lib/stores/uicards.svelte.ts';
  import { buildPreviewSlotIndex, conflictsWithPreview } from '../../lib/domain/conflict';
  import { keyOf, normSeq } from '../../lib/core/utils';

  let { course }: { course: Course } = $props();

  let busy = $state(false);
  let selFlag = $state<string>(baseFlag(course));
  let selZy = $state<number>(3);
  let chainFull = $state(false);

  $effect(() => {
    // 等值守卫：仅在真正变化时写，消除「写→失效→重跑」振荡面
    const nf = course.selected ? typeCodeToFlag(course.typeCode) : selFlag;
    const nz = course.selected ? course.zy || 3 : selZy;
    if (nf !== selFlag) selFlag = nf;
    if (nz !== selZy) selZy = nz;
  });

  const origins = $derived(originOf(course.code));
  const vc = $derived(volColor(course, session.isQueuePhase));
  const scoreRef = $derived(course._scoreRef);

  const qKey = $derived(course.code + '_' + normSeq(course.seq));
  const qd = $derived(session.queueDataMap[qKey]);
  const cand = $derived(session.candidateCourses.find((cc) => keyOf(cc.code, cc.seq) === keyOf(course.code, course.seq)));

  const curFlag = $derived(course.selected ? typeCodeToFlag(course.typeCode) : (selFlag as Flag));
  const curZy = $derived(course.selected ? course.zy || 3 : selZy);
  const selZyDisp = $derived(course.zy || 0); // 志愿档缺失（0）时整段隐藏，同旧版兜底
  const meta = $derived.by(() => currentProbMeta(course, curFlag, curZy));

  const conflicts = $derived.by(() => {
    const idx = buildPreviewSlotIndex(selectedPreviewRows() as Course[], session.manualEvents);
    return conflictsWithPreview(course, idx);
  });

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

  // ─── 时间标签（口径与冲突/课表一致：周四·11-12节） ───
  const timeSlots = $derived(parseTimeSlots(course.time));

  const flagShort = (f: Flag): string => (f === 'bx' ? '必' : f === 'xx' ? '限' : f === 'rx' ? '任' : '体');

  /** 级联中签率链：节点=类型×志愿，底色=各自概率；当前选法描边；点击查看趋势 */
  interface ChainNode {
    key: string;
    label: string;
    pct: string;
    muted: boolean;
    color: string;
    ratio: string;
    active: boolean;
    title: string;
    flag: Flag;
    zy: number;
  }
  const chain = $derived.by(() => {
    if (session.isQueuePhase) return [] as ChainNode[];
    const out: ChainNode[] = [];
    for (const row of probGridData(course)) {
      for (const cell of row.cells) {
        const active = row.flag === curFlag && cell.zy === curZy;
        const muted = (cell.prob ?? -1) < 0;
        const ratio = cell.ratioLabel || '';
        const title = `${flagName(row.flag)} ${cell.zy}志愿 · ${cell.percentLabel || cell.label}${ratio && ratio !== '无数据' ? ' · ' + ratio : ''} · 点击看趋势`;
        out.push({
          key: row.flag + cell.zy,
          label: flagShort(row.flag) + cell.zy,
          pct: cell.percentLabel || cell.label || '—',
          muted,
          color: cell.color,
          ratio,
          active,
          title,
          flag: row.flag,
          zy: cell.zy,
        });
      }
    }
    return out;
  });

  /** 相对上一志愿窗口的涨跌（百分点；历史不足 2 点 → null 不显示） */
  const cardDelta = $derived.by(() => {
    if (session.isQueuePhase) return null;
    return trendDelta(probHist.map[keyOf(course.code, course.seq)], curFlag, curZy);
  });

  /** 课余量容量状态（仅课余量阶段；预选走级联口径） */
  const cs = $derived(session.isQueuePhase ? capacityStatus(course, qd) : null);

  /** 预选级联拆解：随当前「类型×志愿」选择器联动 */
  const cascade = $derived(session.isQueuePhase ? null : cascadeOf(course, curFlag, curZy));

  /** 容量条文字：课余量「候补位次 · 已选X · 余Y · 排队Z」；预选「同志愿N争s · 已选锁定+优先」 */
  const capText = $derived.by(() => {
    if (session.isQueuePhase) {
      if (!cs) return null;
      const rem = cs.rem != null ? `余${cs.rem}` : '';
      const queue = cs.queue > 0 ? `排队${cs.queue}` : '';
      const base = `已选${cs.used}` + (rem ? ` · ${rem}` : '') + (queue ? ` · ${queue}` : '');
      const prefix = cand ? `候补第${cand.myPos}/${cand.queueTotal} · ` : '';
      const title = `已选${cs.used} · 余${cs.rem ?? '—'} · 排队${cs.queue} · 容量${cs.cap}`;
      return { text: prefix + base, title, pct: cs.pct, color: vc.color };
    }
    const lo = lockedOf(course);
    if (cascade) {
      const denom = (lo && lo.cap) || cascade.pool;
      if (cascade.hasVol) {
        // 条宽=需求口径：上批锁定 + 本批报名(统计页已报) vs 总容量；文字仍显本档 同志愿N争s · 已选锁定+优先
        const used = (lo ? lo.locked : 0) + cascade.prior;
        const demand = (lo ? lo.locked : 0) + (Number(course.volApplied) || 0);
        return {
          text: `${cascade.peers}/${cascade.seats}` + (lo ? ` · 已选${used}` : ''),
          title: (lo ? `已选${lo.locked}(上批)+${cascade.prior}(优先)` : `已选${cascade.prior}(优先)`) + ` · 同志愿${cascade.peers}争${cascade.seats} · 总容量${denom}`,
          pct: Math.min(100, (demand / denom) * 100),
          color: meta.color,
        };
      }
    }
    // 本批志愿数据缺：回退搜索页裸数据（灰条）
    if (lo) {
      return {
        text: `已选${lo.locked} · 余${lo.rem}`,
        title: `已选${lo.locked} · 余${lo.rem} · 总容量${lo.cap}（本批志愿数据缺）`,
        pct: (lo.locked / lo.cap) * 100,
        color: '#9aa1ac',
      };
    }
    return null;
  });

  /** 开课线：课余量已选 / 预选 上批锁定+本批报名 少于 5 人有停开风险 */
  const OPEN_LINE = 5;
  const openRisk = $derived.by(() => {
    if (session.isQueuePhase) {
      if (!cs) return null;
      if (cs.used <= 0 || cs.used >= OPEN_LINE) return null;
      return { used: cs.used, label: '已选' };
    }
    const lo = lockedOf(course);
    const used = (lo ? lo.locked : 0) + (Number(course.volApplied) || 0);
    if (used <= 0 || used >= OPEN_LINE) return null;
    return { used, label: '报名' };
  });

  // ─── 渐进式披露：手动覆盖优先，自动规则兜底
  // （已选/候补/开课线风险默认展开；冲突一律折叠、红标明示课节+课名，压过 available；
  //   available 两阶段统一：课余量按 qRemaining>0 回写，预选为搜索页未满标志） ───
  const cardKey = $derived(keyOf(course.code, course.seq));
  const autoOpen = $derived.by(() => {
    if (course.selected || course.isCandidate || openRisk != null) return true;
    if (conflicts.length > 0) return false;
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

  /** 教师·课序·时间合并小字（折叠行与展开态标签行共用；title 保留原始时间串） */
  const subText = $derived.by(() => {
    const parts: string[] = [];
    if (course.teacher) parts.push(course.teacher);
    if (course.seq) parts.push(course.seq + '课序');
    if (timeSlots.length) {
      parts.push(timeSlots.map((s) => s.day + '·' + s.slot + (s.week !== '全周' ? '(' + s.week + ')' : '')).join(' / '));
    } else if (course.time) {
      parts.push(course.time);
    }
    return parts.join(' · ');
  });

  /** 折叠行关键数字：已选显志愿档；课余量「候补x/y · 余Y · 排队Z」；预选当前选法概率% */
  const miniNum = $derived.by(() => {
    if (course.selected) {
      if (selZyDisp > 0) return { text: '第' + selZyDisp + '志愿', color: '#07a150', title: course.typeLabel || '' };
      return course.typeLabel ? { text: course.typeLabel, color: '#07a150', title: '' } : null;
    }
    if (session.isQueuePhase) {
      if (!cs) return null;
      const rem = cs.rem != null ? '余' + cs.rem : '';
      const q = cs.queue > 0 ? ' · 排队' + cs.queue : '';
      const prefix = cand ? `候补${cand.myPos ?? '?'}/${cand.queueTotal ?? '?'} · ` : '';
      return { text: prefix + rem + q, color: vc.color, title: `已选${cs.used} · 余${cs.rem ?? '—'} · 排队${cs.queue} · 容量${cs.cap}` };
    }
    const ratio = meta.ratioLabel && meta.ratioLabel !== '无数据' ? ' · ' + meta.ratioLabel : '';
    return { text: meta.prob >= 0 ? meta.percentLabel : meta.label, color: meta.color, title: `${meta.flagLabel} ${meta.zy}志愿${ratio}` };
  });

  /** 折叠行冲突明示：首条课节+课名必须可见（不止悬浮），title 带完整清单 */
  const conflictMini = $derived.by(() => {
    if (!conflicts.length) return null;
    const first = conflicts[0]!;
    return {
      label: `冲突 ${first.day}${first.slot} ${first.name}` + (conflicts.length > 1 ? ` +${conflicts.length - 1}` : ''),
      title: '时间冲突：' + conflicts.map((cf) => `${cf.day}${cf.slot} 与「${cf.name}」`).join('；'),
    };
  });

  /** 级联链完整渲染由操作行概率按钮（.nx-prob-btn）切换 chainFull 驱动 */

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

  function canAdj(target: number): boolean {
    return canAdjustZy(session.allCourses, course, target, ZY_LIMITS);
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
            <span class="nx-code-last" title={Number(course.credits) > 0 ? `{course.credits}学分` : undefined}>{codeParts.last}</span>
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
      {#if course.selected}
        <span class="nx-tag nx-tag-sel">已选</span>
      {:else if !course.available}
        <span class="nx-tag nx-tag-no">已满</span>
      {/if}
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
        <button
          type="button"
          class="nx-vol-btn"
          disabled={!(course.zy && course.zy > 1 && canAdj(course.zy - 1))}
          title={course.zy && course.zy > 1 ? (canAdj(course.zy - 1) ? '升为第' + (course.zy - 1) + '志愿' : '该志愿名额已满') : ''}
          onclick={() => {
            void onVolChange('up');
          }}
        >▲</button
        >
        <button
          type="button"
          class="nx-vol-btn"
          disabled={!(course.zy && course.zy < 3 && canAdj(course.zy + 1))}
          title={course.zy && course.zy < 3 ? (canAdj(course.zy + 1) ? '降为第' + (course.zy + 1) + '志愿' : '该志愿名额已满') : ''}
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
          {#each allowedFlags(baseFlag(course)) as f}
            <option value={f}>{flagName(f)}</option>
          {/each}
        </select>
        <select class="nx-zy-select" value={String(selZy)} onchange={(e) => (selZy = parseInt((e.currentTarget as HTMLSelectElement).value) || 3)}>
          <option value="3">3志愿</option>
          <option value="2">2志愿</option>
          <option value="1">1志愿</option>
        </select>
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
      {#if course.selected}
        <span class="nx-tag nx-tag-sel">已选</span>
      {:else if !course.available}
        <span class="nx-tag nx-tag-no">已满</span>
      {/if}
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
