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
  import SlideThumb from './SlideThumb.svelte'

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
      editor.statusMessage = 'This deck has vertical stacks — use the Arrange view (grid button in the toolbar) to reorder slides.'
      editor.arrangeOpen = true
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
        <div class="thumb-holder">
          <SlideThumb
            summary={item}
            current={item.h === editor.slideIndex.h && item.v === (editor.slideIndex.v ?? 0)}
          />
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
    background: var(--ui-surface);
    border-right: 1px solid var(--ui-border-strong);
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
  .thumb-holder {
    flex: 1;
    min-width: 0;
  }
  .num {
    color: var(--ui-faint);
    font-size: 11px;
    min-width: 14px;
    text-align: right;
    padding-top: 2px;
  }
  .thumb-wrap.vertical { margin-left: 14px; }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 5px;
    padding: 8px 10px;
    border-top: 1px solid var(--ui-border-strong);
  }
  .actions button {
    background: var(--ui-control);
    color: var(--ui-text);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius);
    padding: 3px 0;
    cursor: pointer;
    font-family: inherit;
  }
  .actions select {
    grid-column: 1 / -1;
    min-width: 0;
    width: 100%;
    background: var(--ui-control);
    color: var(--ui-text);
    border: 1px solid var(--ui-border);
    border-radius: 5px;
    padding: 3px;
    font-family: inherit;
  }
  .actions button:hover:not(:disabled) {
    background: var(--ui-control-hover);
  }
  .actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .templates { display: grid; grid-template-columns: 1fr; gap: 5px; padding: 8px 10px; border-top: 1px solid var(--ui-border-strong); }
  .templates input, .templates select { min-width: 0; background: var(--ui-control); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 5px; padding: 4px; font-family: inherit; }
  .templates button { background: var(--ui-control); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 5px; padding: 4px; cursor: pointer; font-family: inherit; }
  .templates button:hover { background: var(--ui-control-hover); }
</style>
