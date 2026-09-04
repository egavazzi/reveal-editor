<script>
  // Recompress the deck's images and videos through the local ffmpeg and
  // ImageMagick. Assets run one at a time so the machine stays usable and
  // each one can report its own progress.
  import { onMount } from 'svelte'
  import { converterStatus, listAssets } from '../lib/api.js'
  import { deckMediaAssets, optimizeDeckMedia } from '../lib/optimize-media.js'
  import { editor, runtime } from '../stores/editor.svelte.js'

  let assets = $state([])
  let selected = $state(new Set())
  let loadError = $state('')
  let tools = $state(null)
  let running = $state(false)
  let controller = null
  let active = $state('')
  let progress = $state(0)
  let results = $state({})
  let summary = $state('')

  let options = $state({
    maxDimension: 2560,
    imageQuality: 85,
    imageFormat: 'keep',
    videoCrf: 32,
    minSaving: 10
  })

  const chosen = $derived(assets.filter((a) => selected.has(a.path)))
  const totals = $derived.by(() => {
    let before = 0
    let after = 0
    for (const result of Object.values(results)) {
      if (!result?.path) continue
      before += result.before
      after += result.after
    }
    return { before, after, saved: before - after }
  })

  onMount(() => {
    load()
    const onKeydown = (e) => {
      if (e.key === 'Escape' && !running) {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKeydown, true)
    return () => window.removeEventListener('keydown', onKeydown, true)
  })

  async function load() {
    try {
      const [{ assets: listed }, status] = await Promise.all([listAssets(), converterStatus()])
      tools = status
      assets = deckMediaAssets(listed, runtime.bridge?.slidesEl)
      selected = new Set(assets.filter((a) => a.used).map((a) => a.path))
    } catch (err) {
      console.error('could not list the deck assets:', err)
      loadError = String(err.message ?? err)
    }
  }

  function toggle(path) {
    const next = new Set(selected)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    selected = next
  }

  function toggleAll() {
    selected = selected.size === assets.length ? new Set() : new Set(assets.map((a) => a.path))
  }

  async function run() {
    if (running || chosen.length === 0) return
    running = true
    summary = ''
    results = {}
    controller = new AbortController()
    try {
      const { results: done, saved } = await optimizeDeckMedia({
        paths: chosen.map((a) => a.path),
        options: {
          maxDimension: options.maxDimension,
          imageQuality: options.imageQuality,
          imageFormat: options.imageFormat,
          videoCrf: options.videoCrf,
          minSaving: options.minSaving / 100
        },
        signal: controller.signal,
        onProgress: (path, fraction) => {
          active = path
          progress = fraction
        },
        onResult: (path, result) => {
          results = { ...results, [path]: result }
          active = ''
          progress = 0
        }
      })
      const replaced = done.filter((r) => r.path).length
      summary = replaced === 0
        ? 'Nothing was small enough to be worth replacing — the deck is unchanged.'
        : `Replaced ${replaced} file${replaced === 1 ? '' : 's'}, saving ${formatSize(totals.saved)}` +
          (saved ? '.' : ' — the deck could not be saved, so the originals were kept.')
      editor.statusMessage = summary
      await load()
    } catch (err) {
      console.error('optimizing the deck media failed:', err)
      summary = `Optimization failed: ${err.message}`
    } finally {
      running = false
      active = ''
      progress = 0
      controller = null
    }
  }

  function cancel() {
    controller?.abort()
  }

  function close() {
    if (running) return
    editor.optimizeOpen = false
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return ''
    if (Math.abs(bytes) >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (Math.abs(bytes) >= 1024) return `${Math.round(bytes / 1024)} kB`
    return `${bytes} B`
  }

  function describe(result) {
    if (!result) return ''
    if (result.error) return `Failed: ${result.error}`
    if (result.skipped) return `Skipped: ${result.reason}`
    if (result.kept) return `Kept — only ${formatSize(result.before - result.after)} smaller`
    const percent = Math.round(100 * (1 - result.after / result.before))
    return `${formatSize(result.before)} → ${formatSize(result.after)} (−${percent}%)` +
      (result.deleteError ? ` — original kept: ${result.deleteError}` : '')
  }
</script>

<div class="optimize" role="dialog" aria-modal="true" aria-label="Optimize media">
  <header>
    <h2>Optimize media</h2>
    <span class="hint">Re-encodes the deck's pictures and videos smaller, then points the slides at the results. One undo step puts the slides back.</span>
    <button class="close" onclick={close} disabled={running}>Close</button>
  </header>

  <div class="options">
    <label>Longest side
      <input type="number" min="16" max="16384" step="16" bind:value={options.maxDimension} disabled={running} /> px
    </label>
    <label>JPEG/WebP quality
      <input type="number" min="1" max="100" bind:value={options.imageQuality} disabled={running} />
    </label>
    <label>Image format
      <select bind:value={options.imageFormat} disabled={running}>
        <option value="keep">keep (JPEG stays JPEG, PNG stays PNG)</option>
        <option value="webp">WebP</option>
      </select>
    </label>
    <label>Video quality (CRF)
      <input type="number" min="0" max="63" bind:value={options.videoCrf} disabled={running} />
    </label>
    <label>Replace only if smaller by
      <input type="number" min="0" max="95" bind:value={options.minSaving} disabled={running} /> %
    </label>
  </div>

  {#if loadError}
    <p class="error">Could not list the deck assets: {loadError}</p>
  {/if}
  {#if tools && !tools.ffmpeg}
    <p class="error">ffmpeg is not installed — videos cannot be optimized on this machine.</p>
  {/if}
  {#if tools && !tools.imagemagick}
    <p class="error">ImageMagick is not installed — images cannot be optimized on this machine.</p>
  {/if}

  <div class="table">
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" checked={selected.size === assets.length && assets.length > 0} onchange={toggleAll} disabled={running} aria-label="Select all" /></th>
          <th>File</th>
          <th>Type</th>
          <th class="num">Size</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {#each assets as asset (asset.path)}
          <tr class:unused={!asset.used}>
            <td><input type="checkbox" checked={selected.has(asset.path)} onchange={() => toggle(asset.path)} disabled={running} aria-label={`Optimize ${asset.name}`} /></td>
            <td class="name">{asset.name}{#if !asset.used}<span class="tag">unused</span>{/if}</td>
            <td>{asset.kind} · {asset.extension}</td>
            <td class="num">{formatSize(asset.size)}</td>
            <td class="result">
              {#if active === asset.path}
                <progress max="1" value={progress}></progress> {Math.round(progress * 100)}%
              {:else}
                {describe(results[asset.path])}
              {/if}
            </td>
          </tr>
        {/each}
        {#if assets.length === 0 && !loadError}
          <tr><td colspan="5" class="empty">This deck has no pictures or videos in its assets folder.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>

  <footer>
    {#if summary}<span class="summary">{summary}</span>{/if}
    {#if totals.before > 0 && !summary}
      <span class="summary">Saved so far: {formatSize(totals.saved)}</span>
    {/if}
    {#if running}
      <button onclick={cancel}>Cancel</button>
    {:else}
      <button class="run" onclick={run} disabled={chosen.length === 0 || !editor.ready}>Optimize {chosen.length} file{chosen.length === 1 ? '' : 's'}</button>
    {/if}
  </footer>
</div>

<style>
  .optimize {
    position: fixed;
    inset: 5% 8%;
    z-index: 40;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--ui-border-strong);
    border-radius: 10px;
    background: #121317;
    color: var(--ui-text);
    box-shadow: 0 20px 60px rgba(0, 0, 0, .6);
  }
  header { display: flex; align-items: baseline; gap: 16px; padding: 14px 20px; border-bottom: 1px solid var(--ui-border-strong); background: var(--ui-surface-raised); }
  h2 { margin: 0; font-size: 16px; }
  .hint { flex: 1; color: var(--ui-muted); font-size: 12px; }
  .options { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 12px 20px; border-bottom: 1px solid var(--ui-border); font-size: 12px; }
  .options label { display: flex; align-items: center; gap: 6px; color: var(--ui-muted); }
  .options input[type="number"] { width: 72px; }
  .options input, .options select { padding: 3px 6px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-control); color: var(--ui-text); font: inherit; }
  .table { flex: 1; overflow: auto; padding: 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 5px 8px; text-align: left; border-bottom: 1px solid var(--ui-border); }
  th { position: sticky; top: 0; background: #121317; color: var(--ui-muted); font-weight: 500; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .name { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { margin-left: 6px; padding: 1px 5px; border-radius: 8px; background: var(--ui-control); color: var(--ui-muted); font-size: 10px; }
  .unused { color: var(--ui-muted); }
  .result { color: var(--ui-muted); }
  .result progress { width: 90px; height: 7px; accent-color: var(--ui-primary); vertical-align: middle; }
  .empty { color: var(--ui-muted); }
  .error { margin: 8px 20px 0; color: #e3b76b; font-size: 12px; }
  footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--ui-border-strong); background: var(--ui-surface-raised); }
  .summary { flex: 1; color: var(--ui-muted); font-size: 12px; }
  button { height: 28px; padding: 4px 12px; border: 0; border-radius: var(--ui-radius); background: var(--ui-control); color: var(--ui-text); font: inherit; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--ui-control-hover); }
  button:disabled { opacity: .45; cursor: default; }
  .run { background: var(--ui-primary); }
</style>
