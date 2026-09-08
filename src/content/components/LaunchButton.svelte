<script lang="ts">
  let { onLaunch }: { onLaunch: () => void } = $props();
</script>

<button
  class="launch-pill"
  onclick={(e) => {
    e.stopPropagation();
    onLaunch();
  }}
  title="启动 NextTHUxk 下一代选课"
>
  <span class="othu-logo" style="font-size:13px">
    <span class="lp">(</span><span class="word"><i>O</i><i>n</i><i>e</i></span><span></span><span class="lp"> </span><span class="tu">T</span><span class="tu">H</span><span class="tu">U</span><span class="lp">)</span>
  </span>
  <span>NextTHUxk</span>
</button>

