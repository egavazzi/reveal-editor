<script>
  // Miniature slide preview shared by the sidebar and the arrange view.
  // Renders real content — themed text, images, shapes — scaled to the
  // thumbnail via container-relative (cqw) units.
  import { editor } from '../stores/editor.svelte.js'

  let { summary, current = false } = $props()

  const background = $derived(
    summary.background || summary.deckBackground || '#fff'
  )
</script>

<div
  class="thumb"
  class:current
  style:background-color={background}
  style:background-image={summary.backgroundImage ? `url("${summary.backgroundImage}")` : null}
  style:aspect-ratio={`${editor.settings.width || 960} / ${editor.settings.height || 700}`}
>
  {#each summary.boxes as box, i (i)}
    <div
      class="box {box.kind}"
      style:left="{box.x}%"
      style:top="{box.y}%"
      style:width="{box.w}%"
      style:height="{box.h}%"
    >
      {#if box.kind === 'img'}
        <img src={box.src} alt="" loading="lazy" />
      {:else if box.kind === 'video'}
        <span class="play">▶</span>
      {:else if box.kind === 'shape'}
        {@html box.svg}
      {:else}
        <span
          class="text-content"
          class:bold={box.bold}
          class:mono={box.kind === 'code'}
          style:font-size="{box.fontSize || 3}cqw"
          style:color={box.color || null}
          style:text-align={box.align || null}
        >{box.text}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .thumb {
    position: relative;
    border: 2px solid var(--ui-border);
    border-radius: 4px;
    overflow: hidden;
    background-size: cover;
    background-position: center;
    container-type: inline-size;
  }
  .thumb.current {
    border-color: var(--ui-primary);
  }
  .box {
    position: absolute;
    overflow: hidden;
  }
  .box img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .box.video {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(20, 21, 26, 0.85);
    border-radius: 2px;
  }
  .box.video .play {
    color: #fff;
    font-size: 9cqw;
    opacity: 0.9;
  }
  .box.shape :global(svg) {
    /* neutralize the element's inline canvas geometry inside the box */
    position: static !important;
    left: auto !important;
    top: auto !important;
    transform: none !important;
    width: 100% !important;
    height: 100% !important;
    display: block;
    overflow: visible;
  }
  .box.code {
    background: rgba(127, 127, 127, 0.15);
    border-radius: 2px;
  }
  .text-content {
    display: block;
    width: 100%;
    line-height: 1.2;
    word-break: break-word;
  }
  .text-content.bold {
    font-weight: 700;
  }
  .text-content.mono {
    font-family: ui-monospace, monospace;
  }
</style>
