<script>
  import { dndzone } from 'svelte-dnd-action'
  import { editor, runtime } from '../stores/editor.svelte.js'
  import {
    slideSummaries, slideAdd, slideAddVertical, slideApplyLayout, slideDuplicate,
    slideAddTemplate, slideDelete, slideDemote, slideGoTo, slideMove, slidePromote,
    slideReorder, slideToggleHidden, saveCurrentSlideTemplate
  } from '../lib/actions.js'
  import { getCanvasSize } from '../lib/overlay/editmode.js'
  import { isSlideEmpty, slideLayoutsFor } from '../lib/model/layouts.js'
  import { loadSlideTemplates } from '../lib/model/templates.js'
  import SlideThumb from './SlideThumb.svelte'
  import { icon } from '../lib/icons.js'

  let items = $state([])
  let layout = $state('blank')
  const layouts = $derived(slideLayoutsFor(editor.settings))
  $effect(() => {
    // a theme switch can retire the selected themed layout
    if (!layouts.some((item) => item.id === layout)) layout = 'blank'
  })
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
        class:hidden={item.hidden}
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
        <button
          class="hide-toggle"
          class:on={item.hidden}
          title={item.hidden ? 'Hidden when presenting — click to show' : 'Hide this slide when presenting'}
          onclick={(e) => { e.stopPropagation(); slideToggleHidden(item.h, item.v) }}
        >{@html icon(item.hidden ? 'eyeOff' : 'eye')}</button>
      </div>
    {/each}
  </div>
  <div class="actions">
    <select title="Layout used by the buttons below" bind:value={layout} disabled={!editor.ready}>
      {#each layouts as item}
        <option value={item.id}>{item.label}</option>
      {/each}
    </select>
    <button class="labeled span2" title="New slide after this one, using the selected layout" onclick={() => slideAdd(layout)} disabled={!editor.ready}>{@html icon('plus')} New slide</button>
    <button title="New vertical slide below this one (creates a stack)" onclick={() => slideAddVertical(layout)} disabled={!editor.ready}>{@html icon('addVertical')}</button>
    <button title={currentEmpty ? 'Apply the selected layout to this slide' : 'Apply the selected layout to this slide (replaces its contents — you will be asked first)'} onclick={() => slideApplyLayout(layout)} disabled={!editor.ready}>{@html icon('layout')}</button>
    <button title="Duplicate this slide" onclick={slideDuplicate} disabled={!editor.ready}>{@html icon('duplicate')}</button>
    <button title="Move this slide up / left" onclick={() => slideMove(-1)} disabled={!editor.ready}>{@html icon('chevronUp')}</button>
    <button title="Move this slide down / right" onclick={() => slideMove(1)} disabled={!editor.ready}>{@html icon('chevronDown')}</button>
    <button class="danger" title="Delete this slide" onclick={slideDelete} disabled={!editor.ready || editor.slideCount <= 1}>{@html icon('trash')}</button>
    <button class="labeled span2" title="Tuck this slide under the previous one as a vertical stack" onclick={slideDemote} disabled={!editor.ready || editor.slideIndex.h === 0 || editor.slideIndex.v > 0}>{@html icon('cornerDownRight')} Stack</button>
    <button class="labeled span2" title="Pull this slide out of its vertical stack" onclick={slidePromote} disabled={!editor.ready || editor.slideIndex.v === 0}>{@html icon('cornerLeftUp')} Unstack</button>
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
  .thumb-wrap.hidden .thumb-holder { opacity: 0.4; }
  .hide-toggle {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    background: rgba(18, 19, 23, 0.75);
    color: #d6d7dc;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
  }
  .thumb-wrap:hover .hide-toggle,
  .thumb-wrap:focus-within .hide-toggle,
  .hide-toggle.on { opacity: 1; }
  .hide-toggle:hover { color: #fff; background: rgba(18, 19, 23, 0.9); }
  .hide-toggle :global(svg) {
    width: 12px;
    height: 12px;
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 5px;
    padding: 8px 10px;
    border-top: 1px solid var(--ui-border-strong);
  }
  .actions button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 26px;
    background: var(--ui-control);
    color: var(--ui-text);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius);
    padding: 3px 0;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
  }
  .actions :global(svg) {
    width: 13px;
    height: 13px;
    flex: none;
  }
  .actions .span2 {
    grid-column: span 2;
  }
  .actions .danger:hover:not(:disabled) {
    background: var(--ui-danger);
    border-color: transparent;
    color: #fff;
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
