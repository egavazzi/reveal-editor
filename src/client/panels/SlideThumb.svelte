<script>
  // Schematic slide preview shared by the sidebar and the arrange view.
  import { editor } from '../stores/editor.svelte.js'

  let { summary, current = false } = $props()
</script>

<div
  class="thumb"
  class:current
  style:background={summary.background ?? '#fff'}
  style:aspect-ratio={`${editor.settings.width || 960} / ${editor.settings.height || 700}`}
>
  {#each summary.boxes as box, i (i)}
    <div
      class="box {box.kind}"
      style:left="{box.x}%"
      style:top="{box.y}%"
      style:width="{box.w}%"
      style:height="{box.h}%"
    ></div>
  {/each}
  <span class="title">{summary.title}</span>
</div>

<style>
  .thumb {
    position: relative;
    border: 2px solid var(--ui-border);
    border-radius: 4px;
    overflow: hidden;
  }
  .thumb.current {
    border-color: var(--ui-primary);
  }
  .box {
    position: absolute;
    border-radius: 1px;
  }
  .box.text {
    background: #b9c2cf;
  }
  .box.img {
    background: #8fb6e8;
  }
  .box.shape {
    background: #cfd8b9;
  }
  .title {
    position: absolute;
    left: 3px;
    bottom: 1px;
    right: 3px;
    font-size: 8px;
    color: #555;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }
</style>
