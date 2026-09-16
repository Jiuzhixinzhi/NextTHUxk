<script lang="ts">
  import { addManualEvent } from '../../../lib/stores/session.svelte.ts';
  import { closeModal } from '../../../lib/stores/modal.svelte.ts';
  import { showToast } from '../../../lib/stores/toast.svelte.ts';

  let mf = $state({ name: '', day: '1', begin: '18:00', end: '19:30' });

  function beginMin(s: string): number {
    const p = String(s).split(':');
    return Number(p[0]) * 60 + Number(p[1] || 0);
  }

  async function onSave() {
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
</script>

<div class="nx-manual-form">
  <label>活动名称
    <input class="nx-inp" placeholder="例如：社团例会" bind:value={mf.name} onkeydown={(e) => { if (e.key === 'Enter') void onSave(); }} />
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
  <button class="nx-select-btn" onclick={() => void onSave()}>添加到课表</button>
</div>
