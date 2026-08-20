<script>
  import { onMount } from 'svelte'
  import { fetchDeck } from './lib/api.js'
  import { connectDeck } from './lib/iframe/bridge.js'
  import { stashPristineState } from './lib/model/stash.js'
  import { saveDeck } from './lib/model/save.js'
  import { enterEditMode } from './lib/overlay/editmode.js'
  import { initializeSettings, settingsFromRevealConfig } from './lib/model/settings.js'
  import { isSlideEmpty } from './lib/model/layouts.js'
  import { createOverlay } from './lib/overlay/overlay.js'
  import {
    editElement, handlePaste, snapshotSlide, undoAction, redoAction,
    deleteSelection, copySelection, pasteElements, duplicateSelection,
    nudgeSelection, clearSelection, markDirty, handleFileDrop
  } from './lib/actions.js'
  import { isEditingText, stopTextEdit } from './lib/editors/text.js'
  import { subscribeEvents } from './lib/api.js'
  import { editor, runtime } from './stores/editor.svelte.js'
  import Toolbar from './panels/Toolbar.svelte'
  import FormatBar from './panels/FormatBar.svelte'
  import PopoverEditor from './panels/PopoverEditor.svelte'
  import Sidebar from './panels/Sidebar.svelte'
  import Inspector from './panels/Inspector.svelte'
  import ArrangeView from './panels/ArrangeView.svelte'
  import { icon } from './lib/icons.js'

  let iframeSrc = $state('')
  let strayNavigation = $state(false)
  let pristineHtml = ''
  // remember which panel to restore from the edge handle
  let lastPanel = 'layers'
  $effect(() => {
    if (editor.sidePanel) lastPanel = editor.sidePanel
  })
  const emptySlide = $derived.by(() => {
    void editor.docVersion
    void editor.slideIndex.h
    return Boolean(editor.ready && runtime.bridge?.currentSection && isSlideEmpty(runtime.bridge.currentSection))
  })

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
      const initialSettings = settingsFromRevealConfig(bridge.config(), bridge.doc)
      runtime.editMode = enterEditMode(bridge)
      initializeSettings(bridge, initialSettings)
      runtime.overlay = createOverlay(bridge, {
        onSelectionChange(targets) {
          editor.selectionCount = targets.length
          editor.selectionTag = targets[0]?.tagName.toLowerCase() ?? ''
          editor.selectionVersion++
          // A pinned panel keeps whatever the user chose; otherwise it
          // follows the selection.
          if (!editor.panelPinned) {
            if (targets.length === 1 && editor.selectionTag === 'img') editor.sidePanel = 'image'
            else if (targets.length === 1 && editor.selectionTag === 'video') editor.sidePanel = 'video'
            else if (targets.length === 1 && targets[0].hasAttribute('data-shape')) editor.sidePanel = 'shape'
            else if (targets.length === 1) editor.sidePanel = 'element'
            else if (['image', 'video', 'shape', 'element'].includes(editor.sidePanel)) editor.sidePanel = null
          }
        },
        onBeforeEdit() {
          snapshotSlide()
        },
        onEdit() {
          markDirty()
        },
        onDblClick(el, e, opts) {
          editElement(el, e, opts)
        }
      })
      editor.ready = true
      editor.slideCount = bridge.getSlideEntries().length
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
      // Nothing in the editor ever reloads this iframe — Present and PDF open
      // their own tab — so a second load means the deck navigated somewhere
      // else and took the editing surface with it. There is no browser
      // chrome inside the frame to come back with, so offer the way back.
      node.addEventListener('load', () => (strayNavigation = true))
    } catch (err) {
      editor.error = `Could not attach to deck: ${err.message}`
    }
  }

  async function leaveStrayPage() {
    // The slides the editor was attached to are still intact behind the
    // bridge's document handle, even though the frame now shows another
    // page — so unsaved edits can still be written out before reloading.
    // A text edit interrupted by the navigation never got its commit, and
    // that commit is what marks the deck dirty.
    stopTextEdit()
    if (editor.dirty) {
      await saveDeck()
      if (editor.dirty) return
    }
    window.location.reload()
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
        {#if strayNavigation}
          <div class="stray-nav">
            <p>This view left the deck and is showing another page.</p>
            <button onclick={leaveStrayPage}>
              {editor.dirty || editor.textEditing ? 'Save and go back to the deck' : 'Go back to the deck'}
            </button>
          </div>
        {:else if emptySlide}
          <div class="empty-hint">Choose a layout in the lower-left corner, or add content from the toolbar.</div>
        {/if}
      {/if}
    </main>
    {#if editor.sidePanel}
      <Inspector />
    {:else if editor.ready}
      <button
        class="panel-peek"
        title="Open side panel"
        aria-label="Open side panel"
        onclick={() => (editor.sidePanel = lastPanel)}
      >{@html icon('chevronLeft')}</button>
    {/if}
  </div>

  <PopoverEditor />

  {#if editor.arrangeOpen}<ArrangeView />{/if}

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
  /* Shared design tokens for the editor chrome. */
  :global(:root) {
    --ui-bg: #191a1f;
    --ui-surface: #212228;
    --ui-surface-raised: #26272e;
    --ui-control: #2d2e36;
    --ui-control-hover: #383a44;
    --ui-control-active: #41434f;
    --ui-border: #34353d;
    --ui-border-strong: #101116;
    --ui-text: #e2e3e8;
    --ui-muted: #9a9ba3;
    --ui-faint: #6f7077;
    --ui-accent: #8ab4ff;
    --ui-primary: #3574c4;
    --ui-primary-hover: #4285d6;
    --ui-danger: #b3565e;
    --ui-radius: 6px;
  }
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--ui-bg);
    color: var(--ui-text);
    font-family: system-ui, sans-serif;
    font-size: 14px;
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  /* tucked-away handle to reopen the side panel; slides out on approach */
  .panel-peek {
    position: absolute;
    right: 0;
    top: 50%;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 72px;
    padding: 0;
    transform: translate(14px, -50%);
    background: var(--ui-surface-raised);
    color: var(--ui-muted);
    border: 1px solid var(--ui-border);
    border-right: none;
    border-radius: 9px 0 0 9px;
    cursor: pointer;
    opacity: 0.45;
    transition: transform 0.15s ease, opacity 0.15s ease;
  }
  .panel-peek:hover,
  .panel-peek:focus-visible {
    transform: translate(0, -50%);
    opacity: 1;
    color: var(--ui-text);
  }
  .panel-peek :global(svg) {
    width: 15px;
    height: 15px;
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
  .stray-nav {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 3;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px 26px;
    border: 1px solid #555762;
    border-radius: 9px;
    background: rgba(38, 39, 46, .97);
    box-shadow: 0 6px 28px rgba(0, 0, 0, 0.5);
    color: #c8cad1;
    font-size: 13px;
    text-align: center;
  }
  .stray-nav p {
    margin: 0;
  }
  .stray-nav button {
    padding: 7px 14px;
    border: 1px solid transparent;
    border-radius: var(--ui-radius);
    background: var(--ui-primary);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
  }
  .stray-nav button:hover {
    background: var(--ui-primary-hover);
  }
  .empty-hint {
    position: absolute;
    left: 50%;
    bottom: 28px;
    z-index: 2;
    transform: translateX(-50%);
    pointer-events: none;
    padding: 7px 12px;
    border: 1px solid #555762;
    border-radius: 7px;
    background: rgba(38, 39, 46, .92);
    color: #c8cad1;
    font-size: 12px;
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
    background: var(--ui-surface-raised);
    border-top: 1px solid var(--ui-border-strong);
    min-height: 20px;
    color: var(--ui-muted);
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
</style>
