<script lang="ts">
  import { fetchDetail } from '../../../lib/stores/session.svelte.ts';

  let { code, teacherId }: { code: string; teacherId: string } = $props();

  const detail = $state({ loading: true, fields: [] as [string, string][] });

  /** 详情字段展示顺序（教务字段固定序；未列出的按返回顺序补在尾部） */
  const ORDER = ['课程编号', '课程名称', '总学时数', '总学分', '课程内容简介', 'Course Description', '考核安排', '联系人', '教材及参考书', '上课教师', '选课指导语', '先修要求', '教师教学特色', 'Office Hour', '成绩评定标准', '参考书'];

  $effect(() => {
    const c = code;
    const t = teacherId;
    void (async () => {
      detail.loading = true;
      detail.fields = [];
      const f = await fetchDetail(t, c).catch(() => null);
      if (!f || !Object.keys(f).length) {
        detail.loading = false;
        return;
      }
      const ordered: [string, string][] = [];
      for (const key of ORDER) {
        if (f[key] && f[key].length > 0) ordered.push([key, f[key]]);
      }
      for (const [k, v] of Object.entries(f)) {
        if (!ORDER.includes(k) && v && v.length > 0) ordered.push([k, v]);
      }
      detail.fields = ordered;
      detail.loading = false;
    })();
  });
</script>

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
