<script>
  import { dndzone } from 'svelte-dnd-action'
  import { editor, runtime } from '../stores/editor.svelte.js'
  import {
    slideSummaries, slideAdd, slideAddVertical, slideApplyLayout, slideDuplicate,
    slideAddTemplate, slideDelete, slideDemote, slideGoTo, slideMove, slidePromote,
    slideReorder, saveCurrentSlideTemplate
  } from '../lib/actions.js'
  import { getCanvasSize } from '../lib/overlay/editmode.js'
  import { isSlideEmpty, SLIDE_LAYOUTS } from '../lib/model/layouts.js'
  import { loadSlideTemplates } from '../lib/model/templates.js'

  let items = $state([])
  let layout = $state('blank')
  let templateName = $state('')
  let templateId = $state('')
  let templates = $state(loadSlideTemplates())
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
    if (items.some((item) => item.vertical)) {
      editor.statusMessage = 'Use the up/down buttons to reorder slides while vertical stacks are present.'
      items = slideSummaries(runtime.bridge, getCanvasSize(runtime.bridge))
      return
    }
    slideReorder(items.map((it) => it.index))
  }

  function saveTemplate() {
    if (saveCurrentSlideTemplate(templateName)) {
      templates = loadSlideTemplates()
      templateId = templates.at(-1)?.id || ''
      templateName = ''
    }
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
        class:vertical={item.vertical}
        class:current={item.h === editor.slideIndex.h && item.v === (editor.slideIndex.v ?? 0)}
        onclick={() => slideGoTo(item.h, item.v)}
        onkeydown={(e) => e.key === 'Enter' && slideGoTo(item.h, item.v)}
        role="button"
        tabindex="0"
      >
        <span class="num">{item.h + 1}{item.vertical ? `.${item.v + 1}` : ''}</span>
        <div
          class="thumb"
          style:background={item.background ?? '#fff'}
          style:aspect-ratio={`${editor.settings.width || 960} / ${editor.settings.height || 700}`}
        >
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
    <button title="Add vertical slide with selected layout" onclick={() => slideAddVertical(layout)} disabled={!editor.ready}>+V</button>
    <button title="Apply layout to current empty slide" onclick={() => slideApplyLayout(layout)} disabled={!editor.ready || !currentEmpty}>▦</button>
    <button title="Duplicate slide" onclick={slideDuplicate} disabled={!editor.ready}>⧉</button>
    <button title="Move current slide up/left" onclick={() => slideMove(-1)} disabled={!editor.ready}>↑</button>
    <button title="Move current slide down/right" onclick={() => slideMove(1)} disabled={!editor.ready}>↓</button>
    <button title="Demote horizontal slide into previous vertical stack" onclick={slideDemote} disabled={!editor.ready || editor.slideIndex.h === 0 || editor.slideIndex.v > 0}>↳</button>
    <button title="Promote vertical slide to horizontal" onclick={slidePromote} disabled={!editor.ready || editor.slideIndex.v === 0}>↰</button>
    <button
      title="Delete slide"
      onclick={slideDelete}
      disabled={!editor.ready || editor.slideCount <= 1}
    >🗑</button>
  </div>
  <div class="templates">
    <input aria-label="New template name" placeholder="Template name" bind:value={templateName} />
    <button title="Save current slide as template" onclick={saveTemplate} disabled={!editor.ready}>Save template</button>
    {#if templates.length}
      <select aria-label="Saved slide template" bind:value={templateId}>
        <option value="">Saved templates…</option>
        {#each templates as template}<option value={template.id}>{template.name}</option>{/each}
      </select>
      <button title="Add slide from saved template" onclick={() => slideAddTemplate(templateId)} disabled={!templateId}>Add template</button>
    {/if}
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
    border: 2px solid #3a3b42;
    border-radius: 4px;
    overflow: hidden;
  }
  .thumb-wrap.current .thumb {
    border-color: #2f6fba;
  }
  .thumb-wrap.vertical { margin-left: 14px; }
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
  .templates { display: grid; grid-template-columns: 1fr; gap: 5px; padding: 8px 10px; border-top: 1px solid #131418; }
  .templates input, .templates select { min-width: 0; background: #34353d; color: #d6d7dc; border: 1px solid #45464f; border-radius: 5px; padding: 4px; }
  .templates button { background: #34353d; color: #d6d7dc; border: 1px solid #45464f; border-radius: 5px; padding: 4px; }
</style>
