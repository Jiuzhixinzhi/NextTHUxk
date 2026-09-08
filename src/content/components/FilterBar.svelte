<script lang="ts">
  import { search, setChip, setServerField, setLocalField } from '../../lib/stores/search.svelte.ts';
  import { store, K } from '../../lib/storage/store';

  let open = $state(true);

  $effect(() => {
    if (sessionOpen()) {
      void store.get<boolean>(K.filtersOpen).then((v) => {
        open = !!v;
      });
    }
  });
  function sessionOpen() {
    return true;
  }

  function toggle() {
    open = !open;
    void store.set(K.filtersOpen, open);
  }

  const chips = [
    ['all', '全部'],
    ['available', '可选'],
    ['selected', '已选'],
    ['required', '必修'],
    ['elective', '限选'],
    ['sports', '体育'],
    ['queue', '我的队列'],
    ['plan', '培养方案'],
  ] as const;

  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
</script>

<div style="margin-top:8px;">
  <button class="nx-ghost-btn" style="width:100%;font-size:11px;" onclick={toggle}>
    {open ? '收起筛选 ▴' : '展开筛选 ▾'}
  </button>
  {#if open}
    <div class="flex flex-wrap gap-1.5" style="margin-top:8px;">
      {#each chips as [f, label] (f)}
        <button class:on={search.chip === f} class="nx-chip" onclick={() => setChip(f)}>{label}</button>
      {/each}
    </div>
    <div class="flex gap-1.5 flex-wrap" style="margin-top:8px;">
      <select class="nx-zy-select" style="flex:1;min-width:100px;" value={search.local.conflict} onchange={(e) => setLocalField('conflict', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">不限制冲突</option>
        <option value="noconflict">仅无冲突</option>
        <option value="conflict">仅冲突</option>
      </select>
      <select class="nx-zy-select" style="flex:1;min-width:96px;" value={search.local.credits} onchange={(e) => setLocalField('credits', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">全部学分</option>
        <option value="1">1学分</option>
        <option value="2">2学分</option>
        <option value="3">3学分</option>
        <option value="4">4学分</option>
        <option value="5+">5+学分</option>
      </select>
      <select class="nx-zy-select" style="flex:1;min-width:90px;" value={search.server.day} onchange={(e) => setServerField('day', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">不限周次</option>
        {#each days as d, i}
          <option value={i + 1}>{d}</option>
        {/each}
      </select>
      <select class="nx-zy-select" style="flex:1;min-width:96px;" value={search.server.period} onchange={(e) => setServerField('period', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">不限大节</option>
        {#each [1, 2, 3, 4, 5, 6] as p}
          <option value={p}>第{p}大节</option>
        {/each}
      </select>
    </div>
    <div class="flex gap-1.5" style="margin-top:6px;">
      <select class="nx-zy-select" style="flex:1;min-width:130px;" value={search.local.reviews} onchange={(e) => setLocalField('reviews', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">社区评价: 不限</option>
        <option value="has">有点评</option>
        <option value="cnt5">点评≥5条</option>
        <option value="r45">★≥4.5 好评</option>
        <option value="r40">★≥4.0</option>
        <option value="low">★≤3.0 避雷线</option>
      </select>
      <select class="nx-zy-select" style="flex:1;min-width:170px;" value={search.local.sort} onchange={(e) => setLocalField('sort', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">排序: 默认目录序</option>
        <option value="rate_desc">社区评分 高→低</option>
        <option value="rate_asc">社区评分 低→高</option>
        <option value="cnt_desc">点评数 多→少</option>
      </select>
    </div>
    <div style="margin-top:6px;font-size:10px;color:var(--nx-faint);">北大 / 北外课程时间为通知附件形式（含单双周），无法按星期/大节筛选搜索</div>
    <div class="flex gap-1.5 flex-wrap" style="margin-top:6px;">
      <select class="nx-zy-select" style="flex:1;min-width:100px;" value={search.server.tongshi} onchange={(e) => setServerField('tongshi', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">通识课组: 不限</option>
        <option value="TS1">人文课组</option>
        <option value="TS2">社科课组</option>
        <option value="TS3">艺术课组</option>
        <option value="TS4">科学课组</option>
      </select>
      <select class="nx-zy-select" style="flex:1;min-width:120px;" value={search.server.feature} onchange={(e) => setServerField('feature', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">课程特色: 不限</option>
        <option value="专题研讨课">专题研讨课</option>
        <option value="全外文授课">全外文授课</option>
        <option value="外文授课比例≥50%">双语课(外文≥50%)</option>
        <option value="外文教材">双语课(外文教材)</option>
        <option value="实践课">实践课</option>
        <option value="实验课">实验课</option>
        <option value="挑战性学习">挑战性学习课程</option>
        <option value="文化素质核心课">文化素质核心课</option>
        <option value="新生研讨课">新生研讨课</option>
        <option value="混合式教学">混合式教学</option>
        <option value="精品课">精品课</option>
        <option value="认证外文课">认证外文课</option>
        <option value="通识荣誉课">通识荣誉课</option>
        <option value="语言类">语言类课程</option>
        <option value="通识英语">通识英语</option>
        <option value="公共英语">公共英语</option>
      </select>
      <select class="nx-zy-select" style="flex:1;min-width:100px;" value={search.server.grade} onchange={(e) => setServerField('grade', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">年级: 不限</option>
        {#each ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019'] as g}
          <option value={g}>{g}级</option>
        {/each}
      </select>
      <select class="nx-zy-select" style="flex:1;min-width:106px;" value={search.server.bksrem} onchange={(e) => setServerField('bksrem', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">本科余量: 不限</option>
        <option value=">0">本科余量&gt;0</option>
      </select>
      <select class="nx-zy-select" style="flex:1;min-width:106px;" value={search.server.yjsrem} onchange={(e) => setServerField('yjsrem', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">研院余量: 不限</option>
        <option value=">0">研究生余量&gt;0</option>
      </select>
    </div>
    <input
      type="text"
      class="nx-inp"
      style="width:100%;margin-top:6px;padding:6px 10px;font-size:12px;"
      placeholder="选课文字说明搜索"
      value={search.local.xknote}
      oninput={(e) => setLocalField('xknote', (e.currentTarget as HTMLInputElement).value)}
    />
  {/if}
</div>
