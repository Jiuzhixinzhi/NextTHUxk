<script lang="ts">
  import { modal, closeModal, resolveDialog, resolvePrompt, resolveZyModal } from '../../../lib/stores/modal.svelte.ts';
  import { session } from '../../../lib/stores/session.svelte.ts';
  import { fetchDetail } from '../../../lib/stores/session.svelte.ts';
  import { ensureIndex, tbMatch, tbFetchReviews, tbCourseUrl, tbWriteUrl, tbStars } from '../../../lib/reviews/reviews';
  import { creditSimItems, creditDist } from '../../../lib/domain/probability';
import { flagName } from '../../../lib/domain/flags';
  import { addManualEvent } from '../../../lib/stores/session.svelte.ts';
  import { showToast } from '../../../lib/stores/toast.svelte.ts';
  import type { CreditSimItem, DraftCourse, TbEntry } from '../../../lib/domain/types';

const cur = $derived(modal.cur);

  const detail = $state({ loading: false, fields: [] as [string, string][] });
  const reviews = $state({ loading: false, entry: null as TbEntry | null, results: null as { rating: number; score?: string; created_at?: string; comment?: string }[] | null, error: '' });

  const courseDetailOrder = ['课程编号', '课程名称', '总学时数', '总学分', '课程内容简介', 'Course Description', '考核安排', '联系人', '教材及参考书', '上课教师', '选课指导语', '先修要求', '教师教学特色', 'Office Hour', '成绩评定标准', '参考书'];

  async function onCourseOpen(code: string, teacherId: string) {
    detail.loading = true;
    detail.fields = [];
    const f = await fetchDetail(teacherId, code).catch(() => null);
    detail.loading = false;
    if (!f || !Object.keys(f).length) return;
    const ordered: [string, string][] = [];
    for (const key of courseDetailOrder) {
      if (f[key] && f[key].length > 0) ordered.push([key, f[key]]);
    }
    for (const [k, v] of Object.entries(f)) {
      if (!courseDetailOrder.includes(k) && v && v.length > 0) ordered.push([k, v]);
    }
    detail.fields = ordered;
  }

  async function onReviewsOpen(code: string, seq: string) {
    reviews.loading = true;
    reviews.results = null;
    reviews.error = '';
    reviews.entry = null;
    const c = session.allCourses.find((x) => x.code === code && String(x.seq || '0') === String(seq || '0')) || session.candidateCourses.find((x) => x.code === code);
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
  }

  // ── 学分模拟 ──
  const sim = $state({ mode: 'live' as 'live' | 'override', items: [] as CreditSimItem[] });
  let inputValues: (number | null)[] = $state([]);
  let simTargetInput: string = $state('0');
  let zySel: number[] = $state([]);
  let promptVal: string = $state('');

  function simReinit(courses: DraftCourse[]) {
    const items = creditSimItems(courses, {
      isQueuePhase: session.isQueuePhase,
      queueDataMap: session.queueDataMap as never,
      courseLookup: (code, seq) => session.allCourses.find((x) => x.code === code && String(x.seq || '0') === String(seq || '0')),
    });
    sim.items = items;
    sim.mode = 'live';
    inputValues = items.map((it) => (it.liveProb === null ? null : Math.round(it.liveProb * 100)));
    simTargetInput = String(items.reduce((s, it) => s + it.credits, 0) ? Math.max(0, Math.round(items.reduce((s, it) => s + it.credits, 0) * 0.5)) : 0);
  }

  const simResult = $derived.by(() => {
    if (!sim.items.length) return null;
    const items = sim.items.map((it, i) => {
      const v = inputValues[i] ?? null;
      const eff = v === null ? null : Math.min(Math.max(v, 0), 100) / 100;
      return { ...it, prob: sim.mode === 'live' ? it.liveProb : eff };
    });
    const withProb = items.filter((it) => it.prob !== null);
    if (!withProb.length) return null;
    const dist = creditDist(items);
    if (!dist.points.length) return null;
    const target = Number.isFinite(Number(simTargetInput)) ? Number(simTargetInput) : Math.round(dist.expected);
    const atLeast = dist.points.reduce((acc, pt) => acc + (pt.credits >= target ? pt.prob : 0), 0);
    return { dist, target, atLeast, maxP: Math.max(...dist.points.map((p) => p.prob)) };
  });

  function isDirty(it: CreditSimItem, i: number): boolean {
    const cur = inputValues[i] ?? null;
    if (it.liveProb === null) return cur !== null;
    return cur === null || Math.abs(Math.min(Math.max(cur, 0), 100) / 100 - it.liveProb) > 1e-9;
  }

  function onSimProb(i: number, v: string) {
    inputValues[i] = v === '' ? null : Math.min(Math.max(parseFloat(v) || 0, 0), 100);
    inputValues = [...inputValues];
  }

  function onClose() {
    closeModal();
  }

  $effect(() => {
    const cur = modal.cur;
    if (cur.kind === 'course') void onCourseOpen(cur.code, cur.teacherId);
    else if (cur.kind === 'reviews') void onReviewsOpen(cur.code, cur.seq);
    else if (cur.kind === 'creditSim') simReinit(cur.courses);
    else if (cur.kind === 'zyConfirm') zySel = cur.courses.map((c) => c.zy || 3);
    else if (cur.kind === 'prompt') promptVal = cur.initial;
  });

  // ManualEvent 表单状态
  let mf = $state({ name: '', day: '1', begin: '18:00', end: '19:30' });

  async function onManualSave() {
    const name = mf.name.trim();
    if (!name) {
      showToast(false, '请输入活动名称');
      return;
    }
    if (!/^\d{1,2}:\d{2}$/.test(mf.begin) || !/^\d{1,2}:\d{2}$/.test(mf.end) || beginMin(mf.begin) >= beginMin(mf.end)) {
      showToast(false, '起止时间无效：需 HH:MM 且开始早于结束');
      return;
    }
    await addManualEvent(name, parseInt(mf.day, 10), mf.begin, mf.end);
    mf = { name: '', day: '1', begin: '18:00', end: '19:30' };
    closeModal();
  }

  function beginMin(s: string): number {
    const p = String(s).split(':');
    return Number(p[0]) * 60 + Number(p[1] || 0);
  }
</script>

{#if cur.kind !== 'none'}
  <div
    class="nx-modal-mask show"
    role="dialog"
    onclick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div class="nx-modal">
      <div class="nx-modal-head">
        <div class="nx-modal-title">
          {#if cur.kind === 'course'}
            {session.allCourses.find((x) => x.code === cur.code)?.name || cur.code}（{cur.code}）
          {:else if cur.kind === 'reviews'}
            {session.allCourses.find((x) => x.code === cur.code)?.name || '课程'} · 社区点评
          {:else if cur.kind === 'creditSim'}
            {cur.title} · 学分中签模拟
          {:else if cur.kind === 'manualEvent'}
            添加自定义时间占用
          {:else if cur.kind === 'zyConfirm'}
            志愿信息确认
          {:else if cur.kind === 'dialog'}
            {cur.title}
          {:else if cur.kind === 'prompt'}
            {cur.title}
          {/if}
        </div>
        <button class="nx-modal-close" onclick={onClose}>✕</button>
      </div>

      <div class="nx-modal-body">
        {#if cur.kind === 'course'}
          {#if detail.loading}
            <div class="nx-modal-loading"><span class="nx-spin"></span> 正在加载课程简介…</div>
          {:else if detail.fields.length}
            {#each detail.fields as [label, val]}
              <div class="nx-modal-row">
                <div class="nx-modal-label">{label}</div>
                <div class="nx-modal-val">{val}</div>
              </div>
            {/each}
          {:else}
            <div class="nx-modal-loading">暂无课程简介信息</div>
          {/if}
        {:else if cur.kind === 'reviews'}
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
        {:else if cur.kind === 'creditSim'}
          <div class="nx-sim-modes">
            <button class="nx-sim-mode" class:on={sim.mode === 'live'} onclick={() => (sim.mode = 'live')}>实时取值</button>
            <button class="nx-sim-mode" class:on={sim.mode === 'override'} onclick={() => (sim.mode = 'override')}>手动覆盖</button>
          </div>
          <div class="nx-sim-note">每门课中签概率（实时取值随所选身份/志愿；切「手动覆盖」可修改，留空 = 暂不计入）</div>
          {#if sim.items.length}
            <div class="flex flex-col">
              {#each sim.items as it, i (i)}
                <div class="nx-sim-row">
                  <span class="nx-sim-name" title={it.name}>{it.name}</span>
                  <span class="nx-sim-cred">{it.credits}学分</span>
                  {#if it.flag && it.zy}
                    <span class="nx-sim-tag">{flagName(it.flag)} · {it.zy}志愿</span>
                  {/if}
                  <input
                    class="nx-sim-prob"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    disabled={sim.mode === 'live'}
                    value={inputValues[i] ?? ''}
                    placeholder="0-100"
                    onchange={(e) => onSimProb(i, (e.currentTarget as HTMLInputElement).value)}
                  />
                  {#if isDirty(it, i)}
                    <span class="nx-sim-dirty" title="已手动覆盖">改</span>
                  {/if}
                </div>
              {/each}
            </div>
            {#if simResult}
              <div class="nx-sim-stats">
                <div class="nx-sim-stat">
                  <div class="nx-sim-stat-v">{simResult.dist.expected.toFixed(2)}</div>
                  <div class="nx-sim-stat-k">期望学分</div>
                </div>
                <div class="nx-sim-stat">
                  <div class="nx-sim-stat-v">{simResult.dist.mode}</div>
                  <div class="nx-sim-stat-k">最可能学分</div>
                </div>
                <div class="nx-sim-stat">
                  <div class="nx-sim-stat-v">{Math.round(simResult.atLeast * 10000) / 100}%</div>
                  <div class="nx-sim-stat-k">≥ <input type="number" style="width:46px;padding:1px 4px;border:1px solid rgba(0,0,0,.12);border-radius:5px;font-size:10px;text-align:center;" bind:value={simTargetInput} /> 学分</div>
                </div>
                <div class="nx-sim-stat">
                  <div class="nx-sim-stat-v" style="font-size:11px;margin-top:6px;">
                    {sim.items.length} 门{sim.items.filter((it) => it.prob === null).length ? '（<span style="color:#ee4d4d">' + sim.items.filter((it) => it.prob === null).length + ' 门未计入</span>）' : ''}
                  </div>
                  <div class="nx-sim-stat-k">参与统计</div>
                </div>
              </div>
              <div class="nx-sim-histo">
                {#each simResult.dist.points as pt}
                  <div class="nx-sim-bar-col" title="{pt.credits} 学分 · {Math.round(pt.prob * 100) / 100}%">
                    <div class="nx-sim-bar-val">{Math.round(pt.prob * 100) / 100}%</div>
                    <div class="nx-sim-bar" style="height:{Math.max(3, Math.round((pt.prob / simResult.maxP) * 92))}px;"></div>
                    <div class="nx-sim-bar-x">{pt.credits}</div>
                  </div>
                {/each}
              </div>
              <div class="nx-sim-table-wrap" style="max-height:180px;overflow-y:auto;">
                <table class="nx-sim-table">
                  <thead><tr><th>总学分</th><th>概率</th><th>至少拿到 (≥)</th></tr></thead>
                  <tbody>
                    {#each simResult.dist.points as pt, i (i)}
                      {@const atLeast = simResult.dist.points.slice(i).reduce((s, p) => s + p.prob, 0)}
                      <tr><td>{pt.credits}</td><td>{Math.round(pt.prob * 10000) / 100}%</td><td>{Math.round(atLeast * 10000) / 100}%</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <div class="nx-sim-foot">假设各课中签相互独立（志愿级联已计入单课概率）</div>
            {:else}
              <div class="nx-st">实时数据尚未就绪（无志愿统计 / 课余量阶段已满排队）——可切「手动覆盖」填写</div>
            {/if}
          {:else}
            <div class="nx-modal-loading">没有可模拟的课程</div>
          {/if}
        {:else if cur.kind === 'manualEvent'}
          <div class="nx-manual-form">
            <label>活动名称
              <input class="nx-inp" placeholder="例如：社团例会" bind:value={mf.name} onkeydown={(e) => { if (e.key === 'Enter') void onManualSave(); }} />
            </label>
            <label>星期
              <select class="nx-inp" bind:value={mf.day}>
                {#each ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as day, i}
                  <option value={i + 1}>{day}</option>
                {/each}
              </select>
            </label>
            <div style="display:flex;gap:8px;">
              <label style="flex:1;">开始时间<input type="time" class="nx-inp" bind:value={mf.begin} /></label>
              <label style="flex:1;">结束时间<input type="time" class="nx-inp" bind:value={mf.end} /></label>
            </div>
            <div class="nx-manual-hint">自由时间轴：任意起止钟点（不限于大节），保存在本地并参与冲突检测。</div>
            <button class="nx-select-btn" onclick={() => void onManualSave()}>添加到课表</button>
          </div>
        {:else if cur.kind === 'zyConfirm'}
          <div class="nx-zy-hint">以下课程未能自动获取志愿信息，请手动确认：</div>
          {#each cur.courses as c, i}
            <div class="nx-zy-row">
              <span class="nx-zy-name">{c.name}</span>
              <span class="nx-zy-type">{c.typeLabel || '?'}</span>
              <select class="nx-zy-select" value={String(zySel[i] ?? 3)} onchange={(e) => { zySel[i] = parseInt((e.currentTarget as HTMLSelectElement).value) || 3; zySel = [...zySel]; }}>
                <option value="1">第1志愿</option>
                <option value="2">第2志愿</option>
                <option value="3">第3志愿</option>
              </select>
            </div>
          {/each}
          <div style="padding:12px 0 0;display:flex;justify-content:flex-end;">
            <button class="nx-zy-ok" onclick={() => resolveZyModal(zySel)}>确认</button>
          </div>
        {:else if cur.kind === 'dialog'}
          <div style="font-size:13px;line-height:1.7;color:var(--nx-ink);">{cur.message}</div>
          <div class="flex justify-end" style="gap:8px;margin-top:18px;">
            <button class="nx-ghost-btn" onclick={() => resolveDialog(false)}>取消</button>
            <button class="nx-select-btn" style={cur.danger ? 'background:var(--nx-red);' : ''} onclick={() => resolveDialog(true)}>
              {cur.confirmText || '确定'}
            </button>
          </div>
        {:else if cur.kind === 'prompt'}
          {#if cur.message}
            <div style="font-size:12px;color:var(--nx-ink-soft);margin-bottom:8px;">{cur.message}</div>
          {/if}
          <input
            class="nx-inp"
            style="width:100%;font-size:13px;padding:8px 10px;"
            placeholder={cur.placeholder || ''}
            bind:value={promptVal}
            onkeydown={(e) => {
              if (e.key === 'Enter') resolvePrompt(promptVal);
            }}
          />
          <div class="flex justify-end" style="gap:8px;margin-top:18px;">
            <button class="nx-ghost-btn" onclick={() => resolvePrompt(null)}>取消</button>
            <button class="nx-select-btn" onclick={() => resolvePrompt(promptVal)}>确定</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
