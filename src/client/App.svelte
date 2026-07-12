<script>
  import { onMount } from 'svelte'
  import { fetchDeck } from './lib/api.js'
  import { connectDeck } from './lib/iframe/bridge.js'
  import { editor, runtime } from './stores/editor.svelte.js'

  let iframeEl
  let iframeSrc = $state('')

  onMount(async () => {
    try {
      const { file, mtimeMs } = await fetchDeck()
      editor.deckFile = file
      editor.mtimeMs = mtimeMs
      iframeSrc = `/deck/${encodeURIComponent(file)}?editmode=1`
    } catch (err) {
      editor.error = `Could not load deck: ${err.message}`
    }
  })

  async function onIframeSrcSet(node) {
    try {
      const bridge = await connectDeck(node)
      runtime.bridge = bridge
      editor.ready = true
      editor.slideCount = bridge.getSections().length
      editor.slideIndex = bridge.getIndex()
      bridge.Reveal.on('slidechanged', () => {
        editor.slideIndex = runtime.bridge.getIndex()
      })
    } catch (err) {
      editor.error = `Could not attach to deck: ${err.message}`
    }
  }

  function prev() {
    runtime.bridge?.prev()
  }
  function next() {
    runtime.bridge?.next()
  }
</script>

<div class="editor">
  <header class="toolbar">
    <span class="brand">reveal-editor</span>
    <span class="deck-name">{editor.deckFile ?? '…'}</span>
    <div class="spacer"></div>
    <button onclick={prev} disabled={!editor.ready}>←</button>
    <span class="slide-indicator">
      {editor.ready ? `${editor.slideIndex.h + 1} / ${editor.slideCount}` : '–'}
    </span>
    <button onclick={next} disabled={!editor.ready}>→</button>
  </header>

  <main class="stage">
    {#if editor.error}
      <div class="error-banner">{editor.error}</div>
    {:else if iframeSrc}
      <iframe
        bind:this={iframeEl}
        src={iframeSrc}
        title="presentation"
        use:onIframeSrcSet
      ></iframe>
    {/if}
  </main>

  <footer class="statusbar">
    <span>{editor.statusMessage}</span>
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
  .spacer {
    flex: 1;
  }
  .slide-indicator {
    min-width: 60px;
    text-align: center;
  }
  button {
    background: #34353d;
    color: #d6d7dc;
    border: 1px solid #45464f;
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: #3f4049;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
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
    padding: 4px 14px;
    background: #26272e;
    border-top: 1px solid #131418;
    min-height: 20px;
    color: #9a9ba3;
  }
</style>
