<script>
  import { editor } from '../stores/editor.svelte.js'
  import { REVEAL_THEMES, TYPOGRAPHY_PRESETS } from '../lib/model/settings.js'
  import {
    currentLayers, selectLayer, toggleLayerHidden, toggleLayerLocked, moveLayer,
    currentSpeakerNotes, selectedImageInfo, setImageProperties, setSpeakerNotes,
    updateDeckSettings as updateSettings
  } from '../lib/actions.js'

  const presets = {
    'standard': [960, 700],
    'widescreen': [1280, 720],
    'wide-hd': [1920, 1080],
    'square': [1080, 1080],
    'portrait': [1080, 1920]
  }

  const layers = $derived.by(() => {
    void editor.docVersion
    void editor.selectionCount
    void editor.selectionVersion
    void editor.slideIndex.h
    return currentLayers()
  })
  const image = $derived.by(() => {
    void editor.docVersion
    void editor.selectionCount
    void editor.selectionVersion
    return selectedImageInfo()
  })
  const notes = $derived.by(() => {
    void editor.docVersion
    void editor.slideIndex.h
    return currentSpeakerNotes()
  })

  function setPreset(e) {
    const size = presets[e.currentTarget.value]
    if (size) updateSettings({ width: size[0], height: size[1] })
  }
</script>

<aside class="inspector">
  <header>
    <button class:active={editor.sidePanel === 'layers'} onclick={() => editor.sidePanel = 'layers'}>Layers</button>
    <button class:active={editor.sidePanel === 'settings'} onclick={() => editor.sidePanel = 'settings'}>Deck</button>
    <button class:active={editor.sidePanel === 'notes'} onclick={() => editor.sidePanel = 'notes'}>Notes</button>
    {#if image}<button class:active={editor.sidePanel === 'image'} onclick={() => editor.sidePanel = 'image'}>Image</button>{/if}
    <button class="close" title="Close panel" onclick={() => editor.sidePanel = null}>×</button>
  </header>

  {#if editor.sidePanel === 'layers'}
    <section class="panel layers">
      <h3>Slide layers</h3>
      <p class="hint">Frontmost objects are listed first.</p>
      {#if layers.length === 0}<p class="empty">This slide is empty.</p>{/if}
      {#each layers as layer (layer.el)}
        <div class:selected={layer.selected} class:hidden={layer.hidden} class="layer">
          <button class="name" title={layer.label} onclick={() => selectLayer(layer.el)}>
            <span class="tag">{layer.tag}</span>{layer.label}
          </button>
          <button title="Move forward one level" onclick={() => moveLayer(layer.el, 'up')}>↑</button>
          <button title="Move backward one level" onclick={() => moveLayer(layer.el, 'down')}>↓</button>
          <button title={layer.hidden ? 'Show layer' : 'Hide layer'} onclick={() => toggleLayerHidden(layer.el)}>{layer.hidden ? '◌' : '◉'}</button>
          <button title={layer.locked ? 'Unlock layer' : 'Lock layer'} onclick={() => toggleLayerLocked(layer.el)}>{layer.locked ? '🔒' : '🔓'}</button>
        </div>
      {/each}
    </section>
  {:else if editor.sidePanel === 'settings'}
    <section class="panel">
      <h3>Appearance</h3>
      <label>Theme
        <select value={editor.settings.theme} onchange={(e) => updateSettings({ theme: e.currentTarget.value })}>
          {#if !editor.settings.theme}
            <option value="">Current deck stylesheet</option>
          {:else if !REVEAL_THEMES.includes(editor.settings.theme)}
            <option value={editor.settings.theme}>Custom ({editor.settings.theme})</option>
          {/if}
          {#each REVEAL_THEMES as theme}
            <option value={theme}>{theme.replaceAll('-', ' ')}</option>
          {/each}
        </select>
      </label>
      <label>Typography
        <select value={editor.settings.typography} onchange={(e) => updateSettings({ typography: e.currentTarget.value })}>
          {#each TYPOGRAPHY_PRESETS as preset}
            <option value={preset.id}>{preset.label}</option>
          {/each}
        </select>
      </label>
      <label>Transition
        <select value={editor.settings.transition} onchange={(e) => updateSettings({ transition: e.currentTarget.value })}>
          <option value="none">None</option><option value="fade">Fade</option><option value="slide">Slide</option>
          <option value="convex">Convex</option><option value="concave">Concave</option><option value="zoom">Zoom</option>
        </select>
      </label>
      <label>Transition speed
        <select value={editor.settings.transitionSpeed} onchange={(e) => updateSettings({ transitionSpeed: e.currentTarget.value })}>
          <option value="default">Default</option><option value="fast">Fast</option><option value="slow">Slow</option>
        </select>
      </label>

      <h3>Canvas</h3>
      <label>Format
        <select onchange={setPreset}>
          <option value="">Custom</option>
          <option value="standard">Standard 960 × 700</option>
          <option value="widescreen">Widescreen 1280 × 720</option>
          <option value="wide-hd">HD 1920 × 1080</option>
          <option value="square">Square 1080 × 1080</option>
          <option value="portrait">Portrait 1080 × 1920</option>
        </select>
      </label>
      <div class="row">
        <label>Width<input type="number" min="100" value={editor.settings.width} onchange={(e) => updateSettings({ width: +e.currentTarget.value })} /></label>
        <label>Height<input type="number" min="100" value={editor.settings.height} onchange={(e) => updateSettings({ height: +e.currentTarget.value })} /></label>
      </div>
      <label>Presentation margin (%)<input type="number" min="0" max="30" value={editor.settings.margin} onchange={(e) => updateSettings({ margin: +e.currentTarget.value })} /></label>

      <h3>Grid</h3>
      <label class="check"><input type="checkbox" checked={editor.settings.showGrid} onchange={(e) => updateSettings({ showGrid: e.currentTarget.checked })} /> Show grid</label>
      <label class="check"><input type="checkbox" checked={editor.settings.snapGrid} onchange={(e) => updateSettings({ snapGrid: e.currentTarget.checked })} /> Snap objects to grid</label>
      <label>Grid spacing (px)<input type="number" min="2" max="200" value={editor.settings.gridSize} onchange={(e) => updateSettings({ gridSize: +e.currentTarget.value })} /></label>

      <h3>Navigation arrows</h3>
      <label class="check"><input type="checkbox" checked={editor.settings.controls} onchange={(e) => updateSettings({ controls: e.currentTarget.checked })} /> Show navigation arrows</label>

      <h3>Slide numbers</h3>
      <label class="check"><input type="checkbox" checked={editor.settings.slideNumbers} onchange={(e) => updateSettings({ slideNumbers: e.currentTarget.checked })} /> Show slide numbers</label>
      <label>Format<select value={editor.settings.slideNumberFormat} onchange={(e) => updateSettings({ slideNumberFormat: e.currentTarget.value })}>
        <option value="c">Current</option><option value="c/t">Current / total</option><option value="h.v">Horizontal.vertical</option>
      </select></label>
      <label>Position<select value={editor.settings.slideNumberPosition} onchange={(e) => updateSettings({ slideNumberPosition: e.currentTarget.value })}>
        <option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option>
      </select></label>
    </section>
  {/if}

  {#if editor.sidePanel === 'notes'}
    <section class="panel notes-panel">
      <h3>Speaker notes</h3>
      <p class="hint">Saved as native reveal.js notes for the current slide. Press S while presenting to open speaker view.</p>
      <textarea
        rows="12"
        placeholder="Private notes for this slide…"
        value={notes}
        onchange={(e) => setSpeakerNotes(e.currentTarget.value)}
      ></textarea>
      {#if notes}<button onclick={() => setSpeakerNotes('')}>Clear notes</button>{/if}
    </section>
  {/if}

  {#if image && editor.sidePanel === 'image'}
    <section class="panel image-panel">
      <h3>Image</h3>
      <div class="row">
        <label>Width<input type="number" min="1" value={image.width} onchange={(e) => setImageProperties({ width: +e.currentTarget.value })} /></label>
        <label>Height<input type="number" min="1" value={image.height} onchange={(e) => setImageProperties({ height: +e.currentTarget.value })} /></label>
      </div>
      <label class="check"><input type="checkbox" checked={image.crop} onchange={(e) => setImageProperties({ crop: e.currentTarget.checked })} /> Crop to frame</label>
      {#if image.crop}
        <label>Horizontal crop<input type="range" min="0" max="100" value={image.cropX} onchange={(e) => setImageProperties({ cropX: +e.currentTarget.value })} /></label>
        <label>Vertical crop<input type="range" min="0" max="100" value={image.cropY} onchange={(e) => setImageProperties({ cropY: +e.currentTarget.value })} /></label>
      {/if}
      <div class="row">
        <label>Border<input type="number" min="0" max="40" value={image.borderWidth} onchange={(e) => setImageProperties({ borderWidth: +e.currentTarget.value })} /></label>
        <label>Color<input type="color" value={image.borderColor} onchange={(e) => setImageProperties({ borderColor: e.currentTarget.value })} /></label>
      </div>
      <label>Corner radius<input type="number" min="0" max="500" value={image.radius} onchange={(e) => setImageProperties({ radius: +e.currentTarget.value })} /></label>
      <label class="check"><input type="checkbox" checked={image.shadow} onchange={(e) => setImageProperties({ shadow: e.currentTarget.checked })} /> Drop shadow</label>
      <label>Link URL<input type="url" placeholder="https://…" value={image.href} onchange={(e) => setImageProperties({ href: e.currentTarget.value })} /></label>
    </section>
  {/if}
</aside>

<style>
  .inspector { width: 290px; background: #222329; border-left: 1px solid #131418; overflow-y: auto; color: #d6d7dc; }
  header { display: flex; gap: 4px; position: sticky; top: 0; z-index: 2; padding: 8px; background: #26272e; border-bottom: 1px solid #131418; }
  button { background: #34353d; color: #d6d7dc; border: 1px solid #45464f; border-radius: 5px; padding: 4px 8px; cursor: pointer; }
  header button.active { background: #2f6fba; color: white; }
  header .close { margin-left: auto; }
  .panel { padding: 10px 12px 16px; border-bottom: 1px solid #3a3b42; }
  h3 { margin: 8px 0; color: #8ab4ff; font-size: 14px; }
  h3:not(:first-child) { margin-top: 20px; }
  label { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; color: #9a9ba3; font-size: 12px; }
  label.check { flex-direction: row; align-items: center; color: #d6d7dc; }
  input, select, textarea { min-width: 0; box-sizing: border-box; width: 100%; background: #34353d; color: #d6d7dc; border: 1px solid #45464f; border-radius: 4px; padding: 4px 6px; }
  textarea { resize: vertical; font: inherit; line-height: 1.4; }
  input[type='checkbox'] { width: auto; } input[type='color'] { height: 30px; padding: 1px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .hint, .empty { margin: 4px 0 10px; color: #777983; font-size: 11px; }
  .layer { display: flex; gap: 3px; margin: 4px 0; opacity: .95; }
  .layer.selected { outline: 1px solid #2f6fba; border-radius: 5px; }
  .layer.hidden { opacity: .5; }
  .layer .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .layer button:not(.name) { padding: 3px 5px; }
  .tag { display: inline-block; color: #8ab4ff; font-size: 9px; margin-right: 5px; text-transform: uppercase; }
  .image-panel { background: #25262d; }
</style>
