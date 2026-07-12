<script>
  import { dndzone } from 'svelte-dnd-action'
  import { editor, runtime } from '../stores/editor.svelte.js'
  import {
    slideSummaries, slideAdd, slideApplyLayout, slideDuplicate, slideDelete, slideGoTo, slideReorder
  } from '../lib/actions.js'
  import { getCanvasSize } from '../lib/overlay/editmode.js'
  import { isSlideEmpty, SLIDE_LAYOUTS } from '../lib/model/layouts.js'

  let items = $state([])
  let layout = $state('blank')
  const currentEmpty = $derived.by(() => {
    void editor.docVersion
    void editor.slideIndex.h
    return Boolean(runtime.bridge?.currentSection && isSlideEmpty(runtime.bridge.currentSection))
  })

  $effect(() => {
    // re-derive whenever content or structure changes
    void editor.docVersion
    void editor.slideCount
    if (editor.ready && runtime.bridge) {
      items = slideSummaries(runtime.bridge, getCanvasSize(runtime.bridge))
    }
  })

  function handleConsider(e) {
    items = e.detail.items
  }

  function handleFinalize(e) {
    items = e.detail.items
    slideReorder(items.map((it) => it.index))
  }
</script>

<aside class="sidebar">
  <div
    class="list"
    use:dndzone={{ items, flipDurationMs: 120, dropTargetStyle: {} }}
    onconsider={handleConsider}
    onfinalize={handleFinalize}
  >
    {#each items as item (item.id)}
      <div
        class="thumb-wrap"
        class:current={item.index === editor.slideIndex.h}
        onclick={() => slideGoTo(item.index)}
        onkeydown={(e) => e.key === 'Enter' && slideGoTo(item.index)}
        role="button"
        tabindex="0"
      >
        <span class="num">{item.index + 1}</span>
        <div class="thumb" style:background={item.background ?? '#fff'}>
          {#each item.boxes as box, i (i)}
            <div
              class="box {box.kind}"
              style:left="{box.x}%"
              style:top="{box.y}%"
              style:width="{box.w}%"
              style:height="{box.h}%"
            ></div>
          {/each}
          <span class="title">{item.title}</span>
        </div>
      </div>
    {/each}
  </div>
  <div class="actions">
    <select title="New slide layout" bind:value={layout} disabled={!editor.ready}>
      {#each SLIDE_LAYOUTS as item}
        <option value={item.id}>{item.label}</option>
      {/each}
    </select>
    <button title="Add slide with selected layout" onclick={() => slideAdd(layout)} disabled={!editor.ready}>+</button>
    <button title="Apply layout to current empty slide" onclick={() => slideApplyLayout(layout)} disabled={!editor.ready || !currentEmpty}>▦</button>
    <button title="Duplicate slide" onclick={slideDuplicate} disabled={!editor.ready}>⧉</button>
    <button
      title="Delete slide"
      onclick={slideDelete}
      disabled={!editor.ready || editor.slideCount <= 1}
    >🗑</button>
  </div>
</aside>

<style>
  .sidebar {
    width: 168px;
    display: flex;
    flex-direction: column;
    background: #222329;
    border-right: 1px solid #131418;
    min-height: 0;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .thumb-wrap {
    position: relative;
    cursor: pointer;
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .num {
    color: #6f7077;
    font-size: 11px;
    min-width: 14px;
    text-align: right;
    padding-top: 2px;
  }
  .thumb {
    position: relative;
    flex: 1;
    aspect-ratio: 960 / 700;
    border: 2px solid #3a3b42;
    border-radius: 4px;
    overflow: hidden;
  }
  .thumb-wrap.current .thumb {
    border-color: #2f6fba;
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
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid #131418;
  }
  .actions button {
    background: #34353d;
    color: #d6d7dc;
    border: 1px solid #45464f;
    border-radius: 6px;
    padding: 3px 0;
    cursor: pointer;
  }
  .actions select {
    grid-column: 1 / -1;
    min-width: 0;
    width: 100%;
    background: #34353d;
    color: #d6d7dc;
    border: 1px solid #45464f;
    border-radius: 5px;
    padding: 3px;
  }
  .actions button:hover:not(:disabled) {
    background: #3f4049;
  }
  .actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
