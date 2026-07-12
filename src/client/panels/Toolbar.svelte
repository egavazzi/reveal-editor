<script>
  import { editor, runtime } from '../stores/editor.svelte.js'
  import {
    addText, addShape, addMath, addCode, addHtml, pickImage, pickVideo, saveDeck,
    undoAction, redoAction, openPresentation
  } from '../lib/actions.js'

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
</script>

<header class="toolbar">
  <span class="brand">reveal-editor</span>
  <span class="deck-name">{editor.deckFile ?? '…'}{editor.dirty ? ' •' : ''}</span>

  <div class="group" class:disabled={!editor.ready}>
    <button title="Text box" onclick={addText}>T</button>
    <button title="Image (or paste with Ctrl+V)" onclick={pickImage}>🖼</button>
    <button title="Video (MP4 or WebM; files can also be dropped)" onclick={pickVideo}>▶</button>
    {#each shapes as s (s.kind)}
      <button title={s.title} onclick={() => addShape(s.kind)}>{s.label}</button>
    {/each}
    <button title="LaTeX math" onclick={addMath}>∑</button>
    <button title="Code block" onclick={addCode}>{'{}'}</button>
    <button title="Custom HTML block" onclick={addHtml}>{'</>'}</button>
  </div>

  <div class="group" class:disabled={!editor.ready}>
    <button title="Layers" onclick={() => togglePanel('layers')}>Layers</button>
    <button title="Deck, grid and presentation settings" onclick={() => togglePanel('settings')}>Deck</button>
    <button title="Speaker notes" onclick={() => togglePanel('notes')}>Notes</button>
  </div>

  <div class="group" class:disabled={!editor.ready}>
    <button title="Undo (Ctrl+Z)" onclick={undoAction}>↶</button>
    <button title="Redo (Ctrl+Shift+Z)" onclick={redoAction}>↷</button>
  </div>

  <div class="spacer"></div>

  <label class="autosave">
    <input type="checkbox" checked={editor.autosave} onchange={toggleAutosave} />
    autosave
  </label>
  <button onclick={() => saveDeck()} disabled={!editor.ready || editor.saving}>
    {editor.saving ? 'Saving…' : 'Save'}
  </button>
  <button title="Open presentation" onclick={() => openPresentation()} disabled={!editor.ready}>Present</button>
  <button title="Open PDF/print view" onclick={() => openPresentation({ pdf: true })} disabled={!editor.ready}>PDF</button>
  <button onclick={() => runtime.bridge?.prev()} disabled={!editor.ready}>←</button>
  <span class="slide-indicator">
    {editor.ready
      ? `${editor.slideIndex.h + 1}${editor.slideIndex.v ? `.${editor.slideIndex.v + 1}` : ''} / ${editor.slideCount}`
      : '–'}
  </span>
  <button onclick={() => runtime.bridge?.next()} disabled={!editor.ready}>→</button>
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: #26272e;
    border-bottom: 1px solid #131418;
  }
  .brand {
    font-weight: 700;
    color: #8ab4ff;
  }
  .deck-name {
    color: #9a9ba3;
  }
  .group {
    display: flex;
    gap: 4px;
    margin-left: 16px;
    padding: 2px 8px;
    border-left: 1px solid #45464f;
    border-right: 1px solid #45464f;
  }
  .group.disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .spacer {
    flex: 1;
  }
  .slide-indicator {
    min-width: 60px;
    text-align: center;
  }
  .autosave {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #9a9ba3;
    font-size: 12px;
    cursor: pointer;
  }
  button {
    background: #34353d;
    color: #d6d7dc;
    border: 1px solid #45464f;
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 14px;
  }
  button:hover:not(:disabled) {
    background: #3f4049;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
