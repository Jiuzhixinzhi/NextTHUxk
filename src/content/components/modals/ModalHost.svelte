<script lang="ts">
  import { modal, closeModal, resolveDialog, resolvePrompt, resolveManualCopy, type ModalState } from '../../../lib/stores/modal.svelte.ts';
  import { session } from '../../../lib/stores/session.svelte.ts';
  import { keyOf } from '../../../lib/core/utils';
  import { copyText } from '../../clipboard';
  import ProbTrendModal from '../ProbTrendModal.svelte';
  import CourseDetailModal from './CourseDetailModal.svelte';
  import ReviewsModal from './ReviewsModal.svelte';
  import CreditSimModal from './CreditSimModal.svelte';
  import ManualEventModal from './ManualEventModal.svelte';
  import ZyConfirmModal from './ZyConfirmModal.svelte';

  const cur = $derived(modal.cur);

  let promptVal: string = $state('');
  let manualCopyEl: HTMLTextAreaElement | undefined = $state();

  $effect(() => {
    if (modal.cur.kind === 'prompt') promptVal = modal.cur.initial;
  });

  const courseName = (code: string, seq?: string, fallback = code): string => {
    const hit = seq !== undefined
      ? session.allCourses.find((x) => keyOf(x.code, x.seq) === keyOf(code, seq))
      : session.allCourses.find((x) => x.code === code);
    return hit?.name || fallback;
  };

  /** 标题（按 kind）：新增弹窗类型只需在此加一行 */
  function titleOf(s: ModalState): string {
    switch (s.kind) {
      case 'course':
        return `${courseName(s.code)}（${s.code}）`;
      case 'reviews':
        return `${courseName(s.code, undefined, '课程')} · 社区点评`;
      case 'probTrend':
        return `${courseName(s.code, s.seq)} · 概率趋势`;
      case 'creditSim':
        return `${s.title} · 学分中签模拟`;
      case 'manualEvent':
        return '添加自定义时间占用';
      case 'zyConfirm':
        return '志愿信息确认';
      case 'dialog':
      case 'prompt':
      case 'manualCopy':
        return s.title;
      default:
        return '';
    }
  }
</script>

{#if cur.kind !== 'none'}
  <div
    class="nx-modal-mask show"
    role="dialog"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeModal();
    }}
  >
    <div class="nx-modal">
      <div class="nx-modal-head">
        <div class="nx-modal-title">{titleOf(cur)}</div>
        <button class="nx-modal-close" onclick={closeModal}>✕</button>
      </div>

      <div class="nx-modal-body">
        {#if cur.kind === 'course'}
          <CourseDetailModal code={cur.code} teacherId={cur.teacherId} />
        {:else if cur.kind === 'reviews'}
          <ReviewsModal code={cur.code} seq={cur.seq} />
        {:else if cur.kind === 'probTrend'}
          <ProbTrendModal code={cur.code} seq={cur.seq} flag={cur.flag} zy={cur.zy} />
        {:else if cur.kind === 'creditSim'}
          <CreditSimModal courses={cur.courses} certainKeys={cur.certainKeys} />
        {:else if cur.kind === 'manualEvent'}
          <ManualEventModal />
        {:else if cur.kind === 'zyConfirm'}
          <ZyConfirmModal courses={cur.courses} />
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
        {:else if cur.kind === 'manualCopy'}
          <div style="font-size:12px;color:var(--nx-ink-soft);margin-bottom:8px;">自动复制失败（无剪贴板权限）——请手动全选复制以下内容：</div>
          <textarea
            class="nx-inp"
            readonly
            style="width:100%;height:180px;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace;resize:vertical;"
            bind:this={manualCopyEl}
          >{cur.text}</textarea>
          <div class="flex justify-end" style="gap:8px;margin-top:18px;">
            <button class="nx-ghost-btn" onclick={() => resolveManualCopy()}>关闭</button>
            <button
              class="nx-select-btn"
              onclick={() => {
                manualCopyEl?.focus();
                manualCopyEl?.select();
                void copyText(cur.text);
              }}>全选并复制</button
            >
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
