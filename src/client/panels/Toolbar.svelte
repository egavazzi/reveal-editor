<script>
  import { editor, runtime } from '../stores/editor.svelte.js'
  import {
    addText, addShape, addMath, addCode, addHtml, pickImage, pickVideo, saveDeck,
    undoAction, redoAction, openPresentation
  } from '../lib/actions.js'
  import { icon } from '../lib/icons.js'

  function toggleAutosave(e) {
    editor.autosave = e.currentTarget.checked
    localStorage.setItem('reveal-editor:autosave', editor.autosave ? '1' : '0')
  }

  function togglePanel(name) {
    editor.sidePanel = editor.sidePanel === name ? null : name
  }

  const shapes = [
    { kind: 'rect', label: '▭', title: 'Rectangle' },
    { kind: 'ellipse', label: '◯', title: 'Ellipse' },
    { kind: 'line', label: '—', title: 'Line' },
    { kind: 'arrow', label: '→', title: 'Arrow' }
  ]

  function insertShape(kind, details) {
    addShape(kind)
    details.open = false
  }
</script>

<header class="toolbar">
  <span class="brand">reveal-editor</span>
  <span class="deck-name" class:dirty={editor.dirty}>{editor.deckFile ?? '…'}</span>

  <div class="group seg" class:disabled={!editor.ready}>
    <button class="ic" title="Text box" onclick={addText}>{@html icon('text')}</button>
    <button class="ic" title="Image (or paste with Ctrl+V)" onclick={pickImage}>{@html icon('image')}</button>
    <button class="ic" title="Video (MP4 or WebM; files can also be dropped)" onclick={pickVideo}>{@html icon('video')}</button>
    <details class="shape-menu">
      <summary class="ic" title="Insert a shape">{@html icon('shapes')}</summary>
      <div class="shape-options">
        {#each shapes as s (s.kind)}
          <button title={`Insert ${s.title.toLowerCase()}`} onclick={(e) => insertShape(s.kind, e.currentTarget.closest('details'))}>
            <span>{s.label}</span>{s.title}
          </button>
        {/each}
      </div>
    </details>
    <button class="ic" title="LaTeX math" onclick={addMath}>{@html icon('math')}</button>
    <button class="ic" title="Code block" onclick={addCode}>{@html icon('code')}</button>
    <button class="ic txt" title="Custom HTML block" onclick={addHtml}>{'</>'}</button>
  </div>

  <div class="group seg" class:disabled={!editor.ready}>
    <button class="ic" class:active={editor.sidePanel === 'layers'} title="Layers" onclick={() => togglePanel('layers')}>{@html icon('layers')}</button>
    <button class="ic" class:active={editor.sidePanel === 'settings'} title="Deck, grid and presentation settings" onclick={() => togglePanel('settings')}>{@html icon('settings')}</button>
    <button class="ic" class:active={editor.sidePanel === 'notes'} title="Speaker notes" onclick={() => togglePanel('notes')}>{@html icon('notes')}</button>
    <button class="ic" class:active={editor.arrangeOpen} title="Arrange slides" onclick={() => (editor.arrangeOpen = !editor.arrangeOpen)}>{@html icon('arrange')}</button>
  </div>

  <div class="group seg" class:disabled={!editor.ready}>
    <button class="ic" title="Undo (Ctrl+Z)" onclick={undoAction}>{@html icon('undo')}</button>
    <button class="ic" title="Redo (Ctrl+Shift+Z)" onclick={redoAction}>{@html icon('redo')}</button>
  </div>

  <div class="spacer"></div>

  <label class="autosave" title="Save automatically shortly after each change">
    <input type="checkbox" checked={editor.autosave} onchange={toggleAutosave} />
    autosave
  </label>
  <button class="primary" onclick={() => saveDeck()} disabled={!editor.ready || editor.saving}>
    {@html icon('save')}{editor.saving ? 'Saving…' : 'Save'}
  </button>
  <div class="group seg">
    <button class="ic wide" title="Open presentation from the first slide" onclick={() => openPresentation()} disabled={!editor.ready}>{@html icon('play')}Present</button>
    <button
      class="ic"
      title={editor.ready
        ? `Open presentation from this slide (${editor.slideIndex.h + 1}${editor.slideIndex.v ? `.${editor.slideIndex.v + 1}` : ''})`
        : 'Open presentation from this slide'}
      aria-label="Open presentation from this slide"
      onclick={() => openPresentation({ fromCurrent: true })}
      disabled={!editor.ready}
    >{@html icon('playFrom')}</button>
    <button class="ic wide" title="Open PDF/print view" onclick={() => openPresentation({ pdf: true })} disabled={!editor.ready}>{@html icon('print')}PDF</button>
  </div>
  <div class="group seg nav">
    <button class="ic" title="Previous slide" onclick={() => runtime.bridge?.prev()} disabled={!editor.ready}>{@html icon('chevronLeft')}</button>
    <span class="slide-indicator">
      {editor.ready
        ? `${editor.slideIndex.h + 1}${editor.slideIndex.v ? `.${editor.slideIndex.v + 1}` : ''} / ${editor.slideCount}`
        : '–'}
    </span>
    <button class="ic" title="Next slide" onclick={() => runtime.bridge?.next()} disabled={!editor.ready}>{@html icon('chevronRight')}</button>
  </div>
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 14px;
    background: var(--ui-surface-raised);
    border-bottom: 1px solid var(--ui-border-strong);
  }
  .brand {
    font-weight: 700;
    color: var(--ui-accent);
    letter-spacing: 0.2px;
  }
  .deck-name {
    color: var(--ui-muted);
    font-size: 12px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .deck-name.dirty::after {
    content: ' ●';
    color: var(--ui-accent);
    font-size: 9px;
    vertical-align: 1px;
  }
  .group {
    display: flex;
    align-items: center;
  }
  .seg {
    gap: 2px;
    padding: 2px;
    background: var(--ui-control);
    border: 1px solid var(--ui-border);
    border-radius: 8px;
  }
  .group.disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .spacer {
    flex: 1;
  }
  .slide-indicator {
    min-width: 52px;
    text-align: center;
    color: var(--ui-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .autosave {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--ui-muted);
    font-size: 12px;
    cursor: pointer;
  }
  .autosave input {
    accent-color: var(--ui-primary);
  }
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: transparent;
    color: var(--ui-text);
    border: none;
    border-radius: var(--ui-radius);
    padding: 5px 12px;
    height: 28px;
    box-sizing: border-box;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
  }
  button:hover:not(:disabled) {
    background: var(--ui-control-hover);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button.active {
    background: var(--ui-primary);
    color: #fff;
  }
  .ic {
    width: 30px;
    padding: 5px 0;
  }
  .ic.txt {
    font-size: 12px;
    font-weight: 600;
  }
  .ic.wide {
    width: auto;
    padding: 5px 12px;
  }
  :global(.toolbar svg) {
    width: 15px;
    height: 15px;
    display: block;
    flex: none;
  }
  .primary {
    background: var(--ui-primary);
    color: #fff;
    border: 1px solid transparent;
    padding: 5px 14px;
  }
  .primary:hover:not(:disabled) {
    background: var(--ui-primary-hover);
  }
  .nav {
    background: transparent;
    border-color: transparent;
  }
  .shape-menu {
    position: relative;
  }
  .shape-menu summary {
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 28px;
    box-sizing: border-box;
    border-radius: var(--ui-radius);
    color: var(--ui-text);
    cursor: pointer;
  }
  .shape-menu summary:hover {
    background: var(--ui-control-hover);
  }
  .shape-menu[open] summary {
    background: var(--ui-control-active);
  }
  .shape-menu summary::-webkit-details-marker {
    display: none;
  }
  .shape-options {
    position: absolute;
    z-index: 20;
    top: calc(100% + 7px);
    left: 0;
    width: 150px;
    padding: 5px;
    background: var(--ui-surface-raised);
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .shape-options button {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    width: 100%;
    text-align: left;
  }
  .shape-options button span {
    width: 22px;
    text-align: center;
    font-size: 16px;
  }
</style>
