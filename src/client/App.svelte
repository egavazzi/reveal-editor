<script>
  import { onMount } from 'svelte'
  import { fetchDeck } from './lib/api.js'
  import { connectDeck } from './lib/iframe/bridge.js'
  import { stashPristineState } from './lib/model/stash.js'
  import { saveDeck } from './lib/model/save.js'
  import { enterEditMode } from './lib/overlay/editmode.js'
  import { initializeSettings, settingsFromRevealConfig } from './lib/model/settings.js'
  import { createOverlay } from './lib/overlay/overlay.js'
  import {
    editElement, handlePaste, snapshotSlide, undoAction, redoAction,
    deleteSelection, copySelection, pasteElements, duplicateSelection,
    nudgeSelection, clearSelection, markDirty, handleFileDrop
  } from './lib/actions.js'
  import { isEditingText } from './lib/editors/text.js'
  import { subscribeEvents } from './lib/api.js'
  import { editor, runtime } from './stores/editor.svelte.js'
  import Toolbar from './panels/Toolbar.svelte'
  import FormatBar from './panels/FormatBar.svelte'
  import PopoverEditor from './panels/PopoverEditor.svelte'
  import Sidebar from './panels/Sidebar.svelte'
  import Inspector from './panels/Inspector.svelte'

  let iframeSrc = $state('')
  let pristineHtml = ''

  onMount(() => {
    ;(async () => {
      try {
        const { file, html, mtimeMs } = await fetchDeck()
        const doc = new DOMParser().parseFromString(html, 'text/html')
        if (doc.querySelector('.slides [data-markdown], .slides section[data-markdown]')) {
          editor.error =
            'This deck uses reveal.js’s markdown plugin (data-markdown). ' +
            'The editor cannot open it: the markdown source is replaced with rendered ' +
            'HTML at load time, so saving would overwrite your markdown with that HTML.'
          return
        }
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
    window.addEventListener('beforeunload', onBeforeUnload)
    const unsubscribe = subscribeEvents((ev) => {
      if (ev.type !== 'deck-changed') return
      if (!editor.dirty) {
        window.location.reload()
      } else {
        editor.statusMessage =
          'Deck changed on disk. Your unsaved edits differ — saving now will fail until you reload.'
      }
    })
    return () => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('paste', handlePaste)
      window.removeEventListener('beforeunload', onBeforeUnload)
      unsubscribe()
    }
  })

  function onBeforeUnload(e) {
    if (editor.dirty) e.preventDefault()
  }

  async function onIframeSrcSet(node) {
    try {
      const bridge = await connectDeck(node)
      runtime.bridge = bridge
      stashPristineState(bridge.slidesEl, pristineHtml)
      const initialSettings = settingsFromRevealConfig(bridge.config())
      runtime.editMode = enterEditMode(bridge)
      initializeSettings(bridge, initialSettings)
      runtime.overlay = createOverlay(bridge, {
        onSelectionChange(targets) {
          editor.selectionCount = targets.length
          editor.selectionTag = targets[0]?.tagName.toLowerCase() ?? ''
          editor.selectionVersion++
          if (targets.length === 1 && editor.selectionTag === 'img') editor.sidePanel = 'image'
          else if (targets.length === 1 && targets[0].hasAttribute('data-shape')) editor.sidePanel = 'shape'
          else if (editor.sidePanel === 'image' || editor.sidePanel === 'shape') editor.sidePanel = null
        },
        onBeforeEdit() {
          snapshotSlide()
        },
        onEdit() {
          markDirty()
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
      bridge.doc.addEventListener('dragover', (e) => {
        if ([...(e.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')) e.preventDefault()
      })
      bridge.doc.addEventListener('drop', handleFileDrop)
    } catch (err) {
      editor.error = `Could not attach to deck: ${err.message}`
    }
  }

  function onKeydown(e) {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key === 's') {
      e.preventDefault()
      saveDeck()
      return
    }
    // Never hijack typing in chrome inputs or contenteditable text.
    const t = e.target
    if (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable || isEditingText()) return
    if (!editor.ready || editor.popover) return

    if (mod && !e.shiftKey && e.key === 'z') {
      e.preventDefault()
      undoAction()
    } else if ((mod && e.key === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault()
      redoAction()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      deleteSelection()
    } else if (mod && e.key === 'c') {
      copySelection()
    } else if (mod && e.key === 'v') {
      // element paste; if the editor clipboard is empty, the paste event
      // may still deliver an image
      if (pasteElements()) e.preventDefault()
    } else if (mod && e.key === 'd') {
      e.preventDefault()
      duplicateSelection()
    } else if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 10 : 1
      const moved = nudgeSelection(
        e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
        e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      )
      if (moved) e.preventDefault()
    } else if (e.key === 'Escape') {
      clearSelection()
    }
  }
</script>

<div class="editor">
  <Toolbar />
  <FormatBar />

  <div class="body">
    <Sidebar />
    <main class="stage">
      {#if editor.error}
        <div class="error-banner">{editor.error}</div>
      {:else if iframeSrc}
        <iframe src={iframeSrc} title="presentation" use:onIframeSrcSet></iframe>
      {/if}
    </main>
    {#if editor.sidePanel}<Inspector />{/if}
  </div>

  <PopoverEditor />

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
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
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
