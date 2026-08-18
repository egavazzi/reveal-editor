<script>
  // Full-screen slide arrangement board (slides.com-style): columns are
  // horizontal positions, stacked cards in a column are a vertical stack.
  // Dragging cards between columns restructures the deck.
  import { onMount } from 'svelte'
  import { dndzone } from 'svelte-dnd-action'
  import { editor, runtime } from '../stores/editor.svelte.js'
  import { slideSummaries, slideArrange, slideToggleHidden } from '../lib/actions.js'
  import { getCanvasSize } from '../lib/overlay/editmode.js'
  import { icon } from '../lib/icons.js'
  import SlideThumb from './SlideThumb.svelte'

  // $state.raw: columns hold DOM sections and largish summary objects, and
  // dnd `consider` fires on every mouse move — deep-proxying all of that per
  // move makes dragging visibly laggy. Updates reassign the array instead.
  let columns = $state.raw([])
  let nextColId = 0

  function build() {
    const bridge = runtime.bridge
    const entries = bridge.getSlideEntries()
    const summaries = slideSummaries(bridge, getCanvasSize(bridge))
    const current = bridge.currentSection
    const byH = []
    summaries.forEach((summary, i) => {
      const { section } = entries[i]
      ;(byH[summary.h] ??= []).push({
        id: summary.id,
        section,
        summary,
        current: section === current
      })
    })
    columns = [...byH.filter(Boolean).map((items) => ({ id: `col-${nextColId++}`, items })), emptyColumn()]
  }

  function emptyColumn() {
    return { id: `col-${nextColId++}`, items: [] }
  }

  onMount(() => {
    // Let the overlay shell paint first so the button feels instant; the
    // board itself fills in on the next frame.
    const raf = requestAnimationFrame(build)
    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        editor.arrangeOpen = false
      }
    }
    window.addEventListener('keydown', onKeydown, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeydown, true)
    }
  })

  // finalize fires on both the source and target zone of a drop — commit once.
  let commitScheduled = false
  function scheduleCommit() {
    if (commitScheduled) return
    commitScheduled = true
    setTimeout(() => {
      commitScheduled = false
      const matrix = columns.map((column) => column.items.map((item) => item.section))
      slideArrange(matrix.filter((column) => column.length))
      build()
    }, 0)
  }

  function considerColumns(e) {
    columns = e.detail.items
  }
  function finalizeColumns(e) {
    columns = e.detail.items
    scheduleCommit()
  }
  function considerCards(colId, e) {
    columns = columns.map((c) => (c.id === colId ? { ...c, items: e.detail.items } : c))
  }
  function finalizeCards(colId, e) {
    considerCards(colId, e)
    scheduleCommit()
  }

  function toggleHidden(item) {
    if (slideToggleHidden(item.summary.h, item.summary.v)) build()
  }

  function jumpTo(section) {
    const entry = runtime.bridge.getSlideEntries().find((e) => e.section === section)
    if (entry) runtime.bridge.goTo(entry.h, entry.v)
    editor.arrangeOpen = false
  }
</script>

<div class="arrange" role="dialog" aria-label="Arrange slides">
  <header>
    <h2>Arrange slides</h2>
    <p class="hint">
      Drag slides to reorder. Drop a slide under another to build a vertical stack,
      or into the empty column to give it its own horizontal position.
      Double-click a slide to jump to it.
    </p>
    <button class="close" title="Close (Esc)" onclick={() => (editor.arrangeOpen = false)}>{@html icon('close')}</button>
  </header>

  <div
    class="board"
    use:dndzone={{ items: columns, type: 'arrange-column', flipDurationMs: 120, dropTargetStyle: {} }}
    onconsider={considerColumns}
    onfinalize={finalizeColumns}
  >
    {#each columns as column, ci (column.id)}
      <div class="column" class:stacked={column.items.length > 1} class:placeholder={column.items.length === 0}>
        <div class="col-head">
          {#if column.items.length === 0}new{:else}{ci + 1}{#if column.items.length > 1}<span class="stack-badge">stack</span>{/if}{/if}
        </div>
        <div
          class="stack"
          use:dndzone={{ items: column.items, type: 'arrange-card', flipDurationMs: 120, dropTargetStyle: {} }}
          onconsider={(e) => considerCards(column.id, e)}
          onfinalize={(e) => finalizeCards(column.id, e)}
        >
          {#each column.items as item, vi (item.id)}
            <div
              class="card"
              class:hidden={item.summary.hidden}
              role="button"
              tabindex="0"
              ondblclick={() => jumpTo(item.section)}
              onkeydown={(e) => e.key === 'Enter' && jumpTo(item.section)}
            >
              <span class="num">{ci + 1}{column.items.length > 1 ? `.${vi + 1}` : ''}</span>
              <button
                class="hide-toggle"
                class:on={item.summary.hidden}
                title={item.summary.hidden ? 'Hidden when presenting — click to show' : 'Hide this slide when presenting'}
                onclick={(e) => { e.stopPropagation(); toggleHidden(item) }}
              >{@html icon(item.summary.hidden ? 'eyeOff' : 'eye')}</button>
              <SlideThumb summary={item.summary} current={item.current} />
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .arrange {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    /* opaque: a translucent full-screen layer forces the browser to keep
       compositing the whole editor (iframe included) underneath on every
       drag frame */
    background: #121317;
    color: var(--ui-text);
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 16px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--ui-border-strong);
    background: var(--ui-surface-raised);
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .hint {
    margin: 0;
    color: var(--ui-muted);
    font-size: 12px;
    flex: 1;
  }
  .close {
    align-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    background: var(--ui-control);
    color: var(--ui-text);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius);
    cursor: pointer;
  }
  .close:hover {
    background: var(--ui-control-hover);
  }
  .close :global(svg) {
    width: 15px;
    height: 15px;
  }
  .board {
    flex: 1;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 20px;
    overflow: auto;
  }
  .column {
    flex: 0 0 190px;
    border-radius: 8px;
    padding: 8px;
    background: var(--ui-surface);
    border: 1px solid var(--ui-border);
  }
  .column.stacked {
    border-color: var(--ui-primary);
  }
  .column.placeholder {
    background: transparent;
    border: 1px dashed var(--ui-border);
  }
  .col-head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ui-faint);
    font-size: 11px;
    padding: 0 2px 6px;
  }
  .stack-badge {
    color: var(--ui-accent);
    border: 1px solid var(--ui-border);
    border-radius: 999px;
    padding: 0 7px;
    font-size: 10px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 110px;
  }
  .column.placeholder .stack {
    position: relative;
  }
  .column.placeholder .stack::after {
    content: 'drop here';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ui-faint);
    font-size: 11px;
    pointer-events: none;
  }
  .card {
    position: relative;
    cursor: grab;
  }
  .card.hidden :global(.thumb) { opacity: 0.4; }
  .hide-toggle {
    position: absolute;
    top: 3px;
    right: 3px;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: rgba(18, 19, 23, 0.75);
    color: #d6d7dc;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
  }
  .card:hover .hide-toggle,
  .card:focus-within .hide-toggle,
  .hide-toggle.on { opacity: 1; }
  .hide-toggle:hover { color: #fff; background: rgba(18, 19, 23, 0.9); }
  .hide-toggle :global(svg) {
    width: 13px;
    height: 13px;
  }
  .num {
    position: absolute;
    top: 3px;
    left: 3px;
    z-index: 1;
    padding: 0 5px;
    border-radius: 4px;
    background: rgba(18, 19, 23, 0.75);
    color: #d6d7dc;
    font-size: 10px;
    pointer-events: none;
  }
</style>
