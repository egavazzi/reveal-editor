<script>
  import { onMount } from 'svelte'
  import { fetchDeck } from './lib/api.js'
  import { connectDeck } from './lib/iframe/bridge.js'
  import { stashPristineState } from './lib/model/stash.js'
  import { saveDeck } from './lib/model/save.js'
  import { enterEditMode } from './lib/overlay/editmode.js'
  import { createOverlay } from './lib/overlay/overlay.js'
  import { editElement, handlePaste } from './lib/actions.js'
  import { editor, runtime } from './stores/editor.svelte.js'
  import Toolbar from './panels/Toolbar.svelte'
  import FormatBar from './panels/FormatBar.svelte'

  let iframeSrc = $state('')
  let pristineHtml = ''

  onMount(() => {
    ;(async () => {
      try {
        const { file, html, mtimeMs } = await fetchDeck()
        editor.deckFile = file
        editor.mtimeMs = mtimeMs
        pristineHtml = html
        iframeSrc = `/deck/${encodeURIComponent(file)}?editmode=1`
      } catch (err) {
        editor.error = `Could not load deck: ${err.message}`
      }
    })()
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('paste', handlePaste)
    return () => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('paste', handlePaste)
    }
  })

  async function onIframeSrcSet(node) {
    try {
      const bridge = await connectDeck(node)
      runtime.bridge = bridge
      stashPristineState(bridge.slidesEl, pristineHtml)
      runtime.editMode = enterEditMode(bridge)
      runtime.overlay = createOverlay(bridge, {
        onSelectionChange(targets) {
          editor.selectionCount = targets.length
          editor.selectionTag = targets[0]?.tagName.toLowerCase() ?? ''
        },
        onEdit() {
          editor.dirty = true
        },
        onDblClick(el) {
          editElement(el)
        }
      })
      editor.ready = true
      editor.slideCount = bridge.getSections().length
      editor.slideIndex = bridge.getIndex()
      bridge.Reveal.on('slidechanged', () => {
        editor.slideIndex = runtime.bridge.getIndex()
      })
      // Shortcuts and paste must also work when focus is inside the iframe.
      bridge.doc.addEventListener('keydown', onKeydown)
      bridge.doc.addEventListener('paste', handlePaste)
    } catch (err) {
      editor.error = `Could not attach to deck: ${err.message}`
    }
  }

  function onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      saveDeck()
    }
  }
</script>

<div class="editor">
  <Toolbar />
  <FormatBar />

  <main class="stage">
    {#if editor.error}
      <div class="error-banner">{editor.error}</div>
    {:else if iframeSrc}
      <iframe src={iframeSrc} title="presentation" use:onIframeSrcSet></iframe>
    {/if}
  </main>

  <footer class="statusbar">
    <span>{editor.statusMessage}</span>
    <span class="spacer"></span>
    <span>
      {editor.selectionCount === 0
        ? ''
        : editor.selectionCount === 1
          ? `<${editor.selectionTag}> selected`
          : `${editor.selectionCount} elements selected`}
    </span>
  </footer>
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
  }
  :global(#app) {
    height: 100%;
  }
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1f24;
    color: #d6d7dc;
    font-family: system-ui, sans-serif;
    font-size: 14px;
  }
  .stage {
    flex: 1;
    position: relative;
    min-height: 0;
    padding: 16px;
    display: flex;
  }
  iframe {
    flex: 1;
    border: none;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  }
  .error-banner {
    margin: auto;
    padding: 16px 24px;
    background: #4a2328;
    border: 1px solid #7c3a42;
    border-radius: 8px;
  }
  .statusbar {
    display: flex;
    gap: 10px;
    padding: 4px 14px;
    background: #26272e;
    border-top: 1px solid #131418;
    min-height: 20px;
    color: #9a9ba3;
  }
  .spacer {
    flex: 1;
  }
</style>
