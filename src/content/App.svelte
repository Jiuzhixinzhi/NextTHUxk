<script lang="ts">
  import { launch, session } from '../lib/stores/session.svelte.ts';
  import { loadDrafts } from '../lib/stores/drafts.svelte.ts';
  import LaunchButton from './components/LaunchButton.svelte';
  import TopBar from './components/TopBar.svelte';
  import SearchBar from './components/SearchBar.svelte';
  import FilterBar from './components/FilterBar.svelte';
  import CourseList from './components/CourseList.svelte';
  import PlanCards from './components/PlanCards.svelte';
  import Timetable from './components/Timetable.svelte';
  import QueuePanel from './components/QueuePanel.svelte';
  import DraftPanel from './components/DraftPanel.svelte';
  import Banner from './components/ui/Banner.svelte';
  import Toast from './components/ui/Toast.svelte';
  import ModalHost from './components/modals/ModalHost.svelte';

  async function openWorkbench() {
    if (session.launching) return;
    await loadDrafts().catch(() => {});
    await launch();
  }
</script>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="lg-refract" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feImage
      href="data:image/svg+xml;charset=utf-8,{encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><radialGradient id="m" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="rgb(128,128,128)"/><stop offset="72%" stop-color="rgb(128,128,128)"/><stop offset="100%" stop-color="rgb(230,230,230)"/></radialGradient></defs><rect width="400" height="400" fill="url(#m)"/></svg>')}"
      result="map"
      x="0"
      y="0"
      width="100%"
      height="100%"
      preserveAspectRatio="none"
    />
    <feDisplacementMap in="SourceGraphic" in2="map" scale="46" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>

<div class="app-root" style="position:fixed;inset:0;pointer-events:none;color:var(--nx-ink);">
  {#if !session.open}
    <LaunchButton onLaunch={openWorkbench} />
  {/if}

  {#if session.open}
    <div class="fixed inset-0 pointer-events-auto flex flex-col" style="background:var(--nx-paper);">
      <Banner />
      <TopBar />
      <div class="flex flex-1 min-h-0">
        <div class="w-1/2 min-w-0 flex flex-col border-r-0" style="border-right:1px solid var(--nx-line)">
          <div style="padding:12px 16px 4px;">
            <SearchBar />
            <FilterBar />
          </div>
          <CourseList />
        </div>
        <div class="w-1/2 min-w-0 overflow-y-auto" style="padding:14px 16px 60px;">
          <PlanCards />
          <Timetable />
          <QueuePanel />
          <DraftPanel />
        </div>
      </div>
    </div>
  {/if}

  <Toast />
  {#if session.open}
    <ModalHost />
  {/if}
</div>
