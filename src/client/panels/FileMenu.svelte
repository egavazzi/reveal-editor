<script>
  import { editor } from '../stores/editor.svelte.js'
  import { importPresentation } from '../lib/import-deck.js'
  import { exportPresentation } from '../lib/export.js'
  import { exportSelfContainedHtml } from '../lib/self-contained.js'

  let open = $state(false)
  let busy = $state(false)
  let fileInput = $state()

  async function importFile(event) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    busy = true
    try {
      const { slideCount, warnings } = await importPresentation(file)
      editor.statusMessage =
        `Imported ${slideCount} slide${slideCount === 1 ? '' : 's'} — not saved yet.` +
        (warnings.length ? ` ${warnings.join(' ')}` : '')
      open = false
    } catch (err) {
      console.error(err)
      editor.statusMessage = `Import failed: ${err.message}`
    } finally {
      busy = false
    }
  }

  function downloadHtml() {
    exportSelfContainedHtml().catch((err) => {
      // exportSelfContainedHtml has already put the message in the status bar.
      console.error(err)
    })
  }
</script>

<div class="file-menu">
  <button class="hamburger" title="Import and export" aria-label="Open file menu" aria-expanded={open} onclick={() => (open = !open)}>
    <span></span><span></span><span></span>
  </button>
  <button class:open class="backdrop" aria-label="Close file menu" tabindex={open ? 0 : -1} onclick={() => (open = false)}></button>
  <section class:open class="menu" aria-label="File menu" aria-hidden={!open} inert={!open}>
    <header><strong>Import & export</strong></header>
    <div class="actions">
      <button onclick={() => fileInput.click()} disabled={busy || !editor.ready}>Upload ZIP or Keynote</button>
      <button class="html-export" onclick={downloadHtml} disabled={!editor.ready || editor.exportProgress}>Download self-contained HTML</button>
      <button onclick={() => exportPresentation('pdf')} disabled={!editor.ready}>Download PDF</button>
      <button onclick={() => exportPresentation('pptx')} disabled={!editor.ready}>Download PPTX</button>
    </div>
    {#if editor.exportProgress}
      <div class="export-progress" aria-live="polite">
        <span>{editor.exportProgress.label}</span>
        <progress max={Math.max(1, editor.exportProgress.total)} value={editor.exportProgress.done}></progress>
        <small>{Math.round(100 * editor.exportProgress.done / Math.max(1, editor.exportProgress.total))}%</small>
      </div>
    {/if}
    <p class="note">An import replaces the slides of the open deck. Undo puts them back; nothing reaches the file until you save.</p>
    <input class="hidden" bind:this={fileInput} type="file" accept=".zip,.key,application/zip,application/x-iwork-keynote-sffkey" onchange={importFile} />
  </section>
</div>

<style>
  .file-menu { position: relative; flex: none; }
  button { display: flex; align-items: center; justify-content: center; gap: 5px; box-sizing: border-box; height: 28px; padding: 5px 10px; border: 0; border-radius: var(--ui-radius); background: transparent; color: var(--ui-text); font: inherit; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--ui-control-hover); }
  button:disabled { opacity: .45; cursor: default; }
  .hamburger { width: 34px; padding: 7px 8px; gap: 3px; flex-direction: column; }
  .hamburger span { display: block; width: 17px; height: 2px; border-radius: 2px; background: currentColor; }
  /* Kept in the DOM and hidden, so the menu never flashes open while the
     browser lays it out. */
  .backdrop { position: fixed; inset: 0; z-index: 29; width: auto; height: auto; visibility: hidden; pointer-events: none; background: transparent; }
  .backdrop.open { visibility: visible; pointer-events: auto; }
  .menu {
    position: absolute; z-index: 30; right: 0; top: calc(100% + 10px); width: 320px;
    overflow: hidden; border: 1px solid var(--ui-border); border-radius: 10px;
    visibility: hidden; pointer-events: none; background: var(--ui-surface-raised); box-shadow: 0 12px 38px rgba(0,0,0,.55);
  }
  .menu.open { visibility: visible; pointer-events: auto; }
  .menu > header { display: flex; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--ui-border); }
  .menu > header strong { flex: 1; font-size: 15px; }
  .actions { display: grid; gap: 6px; padding: 10px; }
  .actions button { width: auto; height: 31px; background: var(--ui-control); }
  .export-progress { display: grid; grid-template-columns: 1fr auto; gap: 5px 8px; padding: 0 12px 10px; color: var(--ui-muted); font-size: 11px; }
  .export-progress span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .export-progress progress { grid-column: 1 / -1; width: 100%; height: 7px; accent-color: var(--ui-primary); }
  .export-progress small { grid-column: 2; grid-row: 1; }
  .note { margin: 0; padding: 0 12px 12px; color: var(--ui-muted); font-size: 11px; line-height: 1.4; }
  .hidden { display: none; }
</style>
