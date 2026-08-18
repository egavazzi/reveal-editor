<script>
  import { editor } from '../stores/editor.svelte.js'
  import { REVEAL_THEMES, TYPOGRAPHY_PRESETS } from '../lib/model/settings.js'
  import {
    currentLayers, selectLayer, toggleLayerHidden, toggleLayerLocked, moveLayer, setLayerName,
    currentSpeakerNotes, selectedElementInfo, selectedImageInfo, setElementProperties,
    selectedShapeInfo, setShapeProperties, resizeDeck,
    selectedVideoInfo, setVideoProperties,
    setImageProperties, setSpeakerNotes, updateDeckSettings as updateSettings
  } from '../lib/actions.js'
  import { icon } from '../lib/icons.js'

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
  const element = $derived.by(() => {
    void editor.docVersion
    void editor.selectionCount
    void editor.selectionVersion
    return selectedElementInfo()
  })
  const notes = $derived.by(() => {
    void editor.docVersion
    void editor.slideIndex.h
    return currentSpeakerNotes()
  })
  const shape = $derived.by(() => {
    void editor.docVersion
    void editor.selectionCount
    void editor.selectionVersion
    return selectedShapeInfo()
  })
  const video = $derived.by(() => {
    void editor.docVersion
    void editor.selectionCount
    void editor.selectionVersion
    return selectedVideoInfo()
  })
  const selectedPreset = $derived.by(() =>
    Object.entries(presets).find(([, size]) =>
      size[0] === Number(editor.settings.width) && size[1] === Number(editor.settings.height)
    )?.[0] ?? ''
  )

  let scaleContent = $state(true)

  // user-resizable panel width, persisted across sessions
  let panelWidth = $state(
    Math.min(560, Math.max(220, Number(localStorage.getItem('reveal-editor:panel-width')) || 290))
  )

  function startPanelResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panelWidth
    // the iframe swallows mousemove; keep it inert while resizing
    document.body.classList.add('re-panel-resizing')
    const onMove = (ev) => {
      panelWidth = Math.min(560, Math.max(220, startWidth + startX - ev.clientX))
    }
    const onUp = () => {
      document.body.classList.remove('re-panel-resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      localStorage.setItem('reveal-editor:panel-width', String(Math.round(panelWidth)))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function setPreset(e) {
    const size = presets[e.currentTarget.value]
    if (size) resizeDeck({ width: size[0], height: size[1] }, { scaleContent })
  }

  function togglePin() {
    editor.panelPinned = !editor.panelPinned
    localStorage.setItem('reveal-editor:panel-pinned', editor.panelPinned ? '1' : '0')
  }

  // which layer is being renamed (double-click a row)
  let renaming = $state(null)

  function commitRename(el, value) {
    renaming = null
    setLayerName(el, value)
  }

  const KIND_GLYPHS = { math: '∑', code: '{ }', html: '</>', video: '▶', group: '▣' }

  // Live playback preview of the selected video, driven directly from the
  // panel. Firefox's native controls misplace their hit zones inside the
  // scaled slide canvas, so the panel is the reliable way to scrub.
  let preview = $state(null)
  $effect(() => {
    const el = video?.el
    if (!el) {
      preview = null
      return
    }
    const sync = () => {
      preview = {
        time: el.currentTime || 0,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
        playing: !el.paused,
        volume: el.volume,
        muted: el.muted
      }
    }
    sync()
    const events = ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'pause', 'volumechange', 'error']
    for (const type of events) el.addEventListener(type, sync)
    return () => {
      for (const type of events) el.removeEventListener(type, sync)
    }
  })

  function previewToggle() {
    const el = video?.el
    if (!el) return
    if (el.paused) el.play().catch(() => {})
    else el.pause()
  }
  function previewSeek(value) {
    const el = video?.el
    if (el && Number.isFinite(value)) el.currentTime = value
  }
  function previewVolume(value) {
    const el = video?.el
    if (!el) return
    el.volume = Math.min(1, Math.max(0, value))
    el.muted = el.volume === 0
  }
  function previewMute() {
    const el = video?.el
    if (el) el.muted = !el.muted
  }
  function fmtTime(s) {
    const whole = Math.max(0, Math.floor(s || 0))
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
  }
</script>

<div class="panel-resizer" role="separator" aria-orientation="vertical" aria-label="Resize panel" onmousedown={startPanelResize}></div>
<aside class="inspector" style:width="{panelWidth}px">
  <header>
    <button class:active={editor.sidePanel === 'layers'} onclick={() => editor.sidePanel = 'layers'}>Layers</button>
    <button class:active={editor.sidePanel === 'settings'} onclick={() => editor.sidePanel = 'settings'}>Deck</button>
    <button class:active={editor.sidePanel === 'notes'} onclick={() => editor.sidePanel = 'notes'}>Notes</button>
    {#if image}<button class:active={editor.sidePanel === 'image'} onclick={() => editor.sidePanel = 'image'}>Image</button>{/if}
    {#if video}<button class:active={editor.sidePanel === 'video'} onclick={() => editor.sidePanel = 'video'}>Video</button>{/if}
    {#if shape}<button class:active={editor.sidePanel === 'shape'} onclick={() => editor.sidePanel = 'shape'}>Shape</button>{/if}
    {#if element && !shape}<button class:active={editor.sidePanel === 'element'} onclick={() => editor.sidePanel = 'element'}>Element</button>{/if}
    <button
      class="pin"
      class:active={editor.panelPinned}
      title={editor.panelPinned ? 'Unpin panel (follow selection again)' : 'Pin panel (stop it from following the selection)'}
      onclick={togglePin}
    >{@html icon('pin')}</button>
    <button class="close" title="Close panel" onclick={() => editor.sidePanel = null}>{@html icon('close')}</button>
  </header>

  {#if editor.sidePanel === 'layers'}
    <section class="panel layers">
      <h3>Slide layers</h3>
      <p class="hint">Frontmost objects are listed first. Double-click a layer to rename it.</p>
      {#if layers.length === 0}<p class="empty">This slide is empty.</p>{/if}
      {#each layers as layer (layer.el)}
        <div class:selected={layer.selected} class:hidden={layer.hidden} class:locked={layer.locked} class="layer">
          <button
            class="row"
            title={layer.label}
            onclick={() => selectLayer(layer.el)}
            ondblclick={() => (renaming = layer.el)}
          >
            <span class="icon {layer.kind}">
              {#if layer.kind === 'text'}
                <span class="t-glyph">T</span>
              {:else if layer.kind === 'image' && layer.src}
                <img src={layer.src} alt="" />
              {:else if layer.kind === 'shape' && layer.svg}
                <span class="shape-ico">{@html layer.svg}</span>
              {:else}
                <span class="glyph">{KIND_GLYPHS[layer.kind] ?? 'T'}</span>
              {/if}
            </span>
            {#if renaming === layer.el}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="rename"
                autofocus
                value={layer.name}
                placeholder={layer.label}
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commitRename(layer.el, e.currentTarget.value)
                  if (e.key === 'Escape') renaming = null
                }}
                onblur={(e) => commitRename(layer.el, e.currentTarget.value)}
              />
            {:else}
              <span class="label" class:preview={!layer.name && layer.preview}>{layer.label}</span>
            {/if}
          </button>
          <span class="controls">
            <button class="ctl move" title="Move forward one level" onclick={() => moveLayer(layer.el, 'up')}>{@html icon('chevronUp')}</button>
            <button class="ctl move" title="Move backward one level" onclick={() => moveLayer(layer.el, 'down')}>{@html icon('chevronDown')}</button>
            <button class="ctl" class:on={layer.locked} title={layer.locked ? 'Unlock layer' : 'Lock layer'} onclick={() => toggleLayerLocked(layer.el)}>{@html icon(layer.locked ? 'lock' : 'unlock')}</button>
            <button class="ctl" class:on={layer.hidden} title={layer.hidden ? 'Show layer' : 'Hide layer'} onclick={() => toggleLayerHidden(layer.el)}>{@html icon(layer.hidden ? 'eyeOff' : 'eye')}</button>
          </span>
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
        <select value={selectedPreset} onchange={setPreset}>
          <option value="">Custom</option>
          <option value="standard">Standard 960 × 700</option>
          <option value="widescreen">Widescreen 1280 × 720</option>
          <option value="wide-hd">HD 1920 × 1080</option>
          <option value="square">Square 1080 × 1080</option>
          <option value="portrait">Portrait 1080 × 1920</option>
        </select>
      </label>
      <div class="row">
        <label>Width<input type="number" min="100" value={editor.settings.width} onchange={(e) => resizeDeck({ width: +e.currentTarget.value }, { scaleContent })} /></label>
        <label>Height<input type="number" min="100" value={editor.settings.height} onchange={(e) => resizeDeck({ height: +e.currentTarget.value }, { scaleContent })} /></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={scaleContent} /> Scale slide content to the new size</label>
      <p class="hint">When enabled, changing the canvas size proportionally moves and resizes everything on every slide.</p>
      <label>Presentation margin (%)<input type="number" min="0" max="30" value={editor.settings.margin} onchange={(e) => updateSettings({ margin: +e.currentTarget.value })} /></label>

      <h3>Grid</h3>
      <label class="check"><input type="checkbox" checked={editor.settings.showGrid} onchange={(e) => updateSettings({ showGrid: e.currentTarget.checked })} /> Show grid</label>
      <label class="check"><input type="checkbox" checked={editor.settings.snapGrid} onchange={(e) => updateSettings({ snapGrid: e.currentTarget.checked })} /> Snap objects to grid</label>
      <label>Grid spacing (px)<input type="number" min="2" max="200" value={editor.settings.gridSize} onchange={(e) => updateSettings({ gridSize: +e.currentTarget.value })} /></label>
      <p class="hint">Hold Ctrl while dragging to ignore snapping temporarily.</p>

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

  {#if video && editor.sidePanel === 'video'}
    <section class="panel video-panel">
      <h3>Video</h3>
      {#if video.broken}
        <p class="hint warn">Your browser can't decode this video file (unsupported codec), so it won't preview or present here. Convert it, e.g.: ffmpeg -i in -c:v libvpx-vp9 -c:a libopus out.webm</p>
      {/if}
      {#if preview}
        <div class="preview-row">
          <button class="pv" title={preview.playing ? 'Pause' : 'Play'} onclick={previewToggle}>{@html icon(preview.playing ? 'pause' : 'play')}</button>
          <input
            class="scrub"
            type="range"
            min="0"
            max={preview.duration || 0}
            step="0.05"
            value={preview.time}
            disabled={!preview.duration}
            aria-label="Seek"
            oninput={(e) => previewSeek(Number(e.currentTarget.value))}
          />
          <span class="time">{fmtTime(preview.time)} / {fmtTime(preview.duration)}</span>
        </div>
        <div class="preview-row">
          <button class="pv" title={preview.muted ? 'Unmute preview' : 'Mute preview'} onclick={previewMute}>{@html icon(preview.muted ? 'volumeMute' : 'volume')}</button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={preview.muted ? 0 : preview.volume}
            aria-label="Preview volume"
            oninput={(e) => previewVolume(Number(e.currentTarget.value))}
          />
        </div>
        <p class="hint">Preview only — playback settings below are what get saved. You can also hold Ctrl to use the player on the canvas.</p>
      {/if}
      <div class="row">
        <label>Width<input type="number" min="1" value={video.width} onchange={(e) => setVideoProperties({ width: +e.currentTarget.value })} /></label>
        <label>Height<input type="number" min="1" value={video.height} onchange={(e) => setVideoProperties({ height: +e.currentTarget.value })} /></label>
      </div>
      <h3>Playback</h3>
      <label class="check"><input type="checkbox" checked={video.autoplay} onchange={(e) => setVideoProperties({ autoplay: e.currentTarget.checked })} /> Autoplay when the slide appears</label>
      <label class="check"><input type="checkbox" checked={video.loop} onchange={(e) => setVideoProperties({ loop: e.currentTarget.checked })} /> Loop</label>
      <label class="check"><input type="checkbox" checked={video.muted} onchange={(e) => setVideoProperties({ muted: e.currentTarget.checked })} /> Start muted</label>
      <label class="check"><input type="checkbox" checked={video.controls} onchange={(e) => setVideoProperties({ controls: e.currentTarget.checked })} /> Show player controls</label>
      {#if video.autoplay && !video.muted}
        <p class="hint">Browsers may block autoplay with sound — enable “Start muted” to make autoplay reliable.</p>
      {/if}
    </section>
  {/if}

  {#if element && editor.sidePanel === 'element'}
    <section class="panel element-panel">
      <h3>{element.group ? 'Group' : 'Element'} geometry</h3>
      <div class="row">
        <label>X<input type="number" value={element.x} onchange={(e) => setElementProperties({ x: +e.currentTarget.value })} /></label>
        <label>Y<input type="number" value={element.y} onchange={(e) => setElementProperties({ y: +e.currentTarget.value })} /></label>
      </div>
      <div class="row">
        <label>Width<input type="number" min="1" value={element.width} onchange={(e) => setElementProperties({ width: +e.currentTarget.value })} /></label>
        <label>Height<input type="number" min="1" value={element.height} onchange={(e) => setElementProperties({ height: +e.currentTarget.value })} /></label>
      </div>
      <label>Rotation (°)<input type="number" step="1" value={element.rotation} onchange={(e) => setElementProperties({ rotation: +e.currentTarget.value })} /></label>
      <label class="check"><input type="checkbox" checked={element.lockRatio} onchange={(e) => setElementProperties({ lockRatio: e.currentTarget.checked })} /> Lock aspect ratio while resizing</label>
    </section>
  {/if}

  {#if shape && editor.sidePanel === 'shape'}
    <section class="panel shape-panel">
      <h3>{shape.kind === 'rect' ? 'Rectangle' : shape.kind[0].toUpperCase() + shape.kind.slice(1)}</h3>
      <h3>Position (px)</h3>
      <div class="row">
        <label>X<input type="number" value={shape.x} onchange={(e) => setShapeProperties({ x: +e.currentTarget.value })} /></label>
        <label>Y<input type="number" value={shape.y} onchange={(e) => setShapeProperties({ y: +e.currentTarget.value })} /></label>
      </div>
      <h3>Size (px)</h3>
      <div class="row">
        <label>Width<input type="number" min="1" value={shape.width} onchange={(e) => setShapeProperties({ width: +e.currentTarget.value })} /></label>
        <label>Height<input type="number" min="1" value={shape.height} onchange={(e) => setShapeProperties({ height: +e.currentTarget.value })} /></label>
      </div>
      {#if shape.kind !== 'line' && shape.kind !== 'arrow'}
        <label>Rotation (°)<input type="number" step="0.1" value={shape.rotation} onchange={(e) => setShapeProperties({ rotation: +e.currentTarget.value })} /></label>
      {:else}
        <p class="hint">Drag either blue endpoint on the canvas to change direction and length.</p>
      {/if}
      <h3>Appearance</h3>
      {#if shape.fill}
        <label>Fill color<input type="color" value={shape.fill} onchange={(e) => setShapeProperties({ fill: e.currentTarget.value })} /></label>
      {/if}
      <div class="row">
        <label>{shape.kind === 'line' || shape.kind === 'arrow' ? 'Color' : 'Outline'}<input type="color" value={shape.stroke} onchange={(e) => setShapeProperties({ stroke: e.currentTarget.value })} /></label>
        <label>Line width<input type="number" min="0" max="40" step="0.5" value={shape.strokeWidth} onchange={(e) => setShapeProperties({ strokeWidth: +e.currentTarget.value })} /></label>
      </div>
    </section>
  {/if}
</aside>

<style>
  .inspector { width: 290px; flex: none; background: var(--ui-surface); border-left: 1px solid var(--ui-border-strong); overflow-y: auto; color: var(--ui-text); }
  .panel-resizer { flex: none; width: 5px; margin-right: -5px; cursor: col-resize; z-index: 3; }
  .panel-resizer:hover, :global(body.re-panel-resizing) .panel-resizer { background: var(--ui-primary); opacity: .6; }
  :global(body.re-panel-resizing) { cursor: col-resize; user-select: none; }
  :global(body.re-panel-resizing iframe) { pointer-events: none; }
  header { display: flex; gap: 4px; position: sticky; top: 0; z-index: 2; padding: 8px; background: var(--ui-surface-raised); border-bottom: 1px solid var(--ui-border-strong); }
  button { background: var(--ui-control); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 5px; padding: 4px 8px; cursor: pointer; font-family: inherit; font-size: 12px; }
  button:hover { background: var(--ui-control-hover); }
  header button.active { background: var(--ui-primary); border-color: transparent; color: white; }
  header .pin { margin-left: auto; }
  header .pin, header .close { display: flex; align-items: center; justify-content: center; width: 26px; padding: 4px 0; }
  header .pin.active { background: var(--ui-primary); border-color: transparent; color: white; }
  .inspector :global(svg) { width: 13px; height: 13px; display: block; flex: none; }
  .panel { padding: 10px 12px 16px; border-bottom: 1px solid var(--ui-border); }
  h3 { margin: 8px 0; color: var(--ui-accent); font-size: 14px; }
  h3:not(:first-child) { margin-top: 20px; }
  label { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; color: var(--ui-muted); font-size: 12px; }
  label.check { flex-direction: row; align-items: center; color: var(--ui-text); }
  input, select, textarea { min-width: 0; box-sizing: border-box; width: 100%; background: var(--ui-control); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 4px; padding: 4px 6px; font-family: inherit; }
  textarea { resize: vertical; font: inherit; line-height: 1.4; }
  input[type='checkbox'] { width: auto; accent-color: var(--ui-primary); } input[type='color'] { height: 30px; padding: 1px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .hint, .empty { margin: 4px 0 10px; color: var(--ui-faint); font-size: 11px; }

  /* layers */
  .layer { display: flex; align-items: center; gap: 2px; margin: 2px 0; border-radius: 6px; padding: 2px; }
  .layer:hover { background: var(--ui-control); }
  .layer.selected { background: var(--ui-control); outline: 1px solid var(--ui-primary); }
  .layer.hidden .label, .layer.hidden .icon { opacity: .45; }
  .layer .row { display: flex; flex: 1; min-width: 0; align-items: center; gap: 9px; background: none; border: none; padding: 3px 4px; text-align: left; cursor: pointer; }
  .layer .row:hover { background: none; }
  .icon { flex: none; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 4px; overflow: hidden; }
  .icon img { width: 22px; height: 22px; object-fit: cover; border-radius: 4px; display: block; }
  .icon .t-glyph { font-family: Georgia, serif; font-size: 15px; color: var(--ui-text); }
  .icon .glyph { font-size: 10px; font-weight: 600; color: var(--ui-muted); letter-spacing: -0.5px; }
  .shape-ico { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; }
  .shape-ico :global(svg) { width: 18px !important; height: 14px !important; overflow: visible; }
  .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--ui-text); }
  .label.preview { font-style: italic; color: var(--ui-muted); }
  .rename { flex: 1; min-width: 0; padding: 2px 5px; font-size: 12px; }
  .controls { display: flex; align-items: center; gap: 1px; }
  .ctl { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; background: none; border: none; color: var(--ui-faint); border-radius: 4px; }
  .ctl:hover { background: var(--ui-control-hover); color: var(--ui-text); }
  .ctl.on { color: var(--ui-accent); }
  .ctl.move { visibility: hidden; }
  .layer:hover .ctl.move { visibility: visible; }

  .image-panel, .shape-panel, .video-panel { background: var(--ui-surface); }
  .preview-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
  .preview-row .pv { flex: none; display: flex; align-items: center; justify-content: center; width: 28px; height: 26px; padding: 0; }
  .preview-row input[type='range'] { flex: 1; width: auto; padding: 0; accent-color: var(--ui-primary); background: transparent; border: none; }
  .preview-row .time { flex: none; color: var(--ui-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .hint.warn { color: #e3b76b; }
</style>
