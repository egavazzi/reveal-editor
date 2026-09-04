// Run the deck's media through the server-side optimizer and move the slides
// onto the results. The whole run is one undo step: the snapshot is taken
// before the first rewrite, so undo puts every reference back at once.
//
// An original is deleted only after the deck has been saved and the saved
// file no longer names it — the file on disk, not the DOM in front of us,
// decides whether the bytes are still needed.
import { deleteAsset, fetchDeck, optimizeAsset } from './api.js'
import { hasReferenceTo, rewriteAssetReferences, samePath } from './model/asset-refs.js'
import { extensionOf, isImagePath, isVideoPath } from './model/codecs.js'
import { markDirty, snapshotDeck } from './actions.js'
import { saveDeck } from './model/save.js'
import { editor, runtime } from '../stores/editor.svelte.js'

/**
 * The deck's images and videos, as
 * `{ path, name, kind, size, used }` — `used` says whether any slide
 * currently refers to the file. Assets that are neither image nor video are
 * left out.
 */
export function deckMediaAssets(assets, slidesEl) {
  return assets
    .filter(({ path }) => isImagePath(path) || isVideoPath(path))
    .map(({ path, size }) => ({
      path,
      name: path.split('/').pop(),
      kind: isVideoPath(path) ? 'video' : 'image',
      extension: extensionOf(path),
      size,
      used: slidesEl ? hasReferenceTo(slidesEl, path) : false
    }))
}

/** Reload the media elements now pointing at `newPath` so they show it. */
function refreshMedia(slidesEl, newPath) {
  for (const video of slidesEl.querySelectorAll('video')) {
    const sources = [video.getAttribute('src'), ...[...video.querySelectorAll('source')].map((s) => s.getAttribute('src'))]
    if (sources.some((src) => src && samePath(src, newPath))) video.load()
  }
}

/**
 * Optimize `paths` (deck-relative) one at a time, rewriting the slides onto
 * each smaller result. Resolves to `{ results, saved }`, where `results` is
 * one entry per path: `source` (the asset asked for) plus the server's
 * `{ path, before, after }`, `{ kept, before, after }` or
 * `{ skipped, reason }`, plus `error` when the asset failed, `references`
 * for the number of rewritten attributes, and `deleted` when the superseded
 * original was removed from disk.
 *
 * `onResult` and `onProgress` report as the run goes, so a caller can show
 * per-asset progress. An aborted `signal` stops before the next asset; the
 * assets already done keep their rewrites.
 */
export async function optimizeDeckMedia({
  paths, options = {}, onProgress = () => {}, onResult = () => {}, signal
} = {}) {
  const bridge = runtime.bridge
  if (!bridge) throw new Error('The deck is not ready yet.')
  const slidesEl = bridge.slidesEl
  const results = []
  let snapshotted = false
  let rewrote = false

  for (const path of paths) {
    if (signal?.aborted) break
    let result
    try {
      result = await optimizeAsset(path, options, { signal, onProgress: (f) => onProgress(path, f) })
    } catch (err) {
      console.error(`optimizing ${path} failed:`, err)
      result = { error: String(err.message ?? err) }
    }
    if (result.path) {
      if (!snapshotted) {
        snapshotDeck()
        snapshotted = true
      }
      result.references = rewriteAssetReferences(slidesEl, path, result.path)
      refreshMedia(slidesEl, result.path)
      rewrote = rewrote || result.references > 0
      markDirty()
    }
    results.push({ source: path, ...result })
    onResult(path, results[results.length - 1])
  }

  if (rewrote) bridge.sync()
  let saved = false
  if (rewrote) {
    await saveDeck()
    saved = !editor.dirty
  }
  if (saved) await deleteSuperseded(results)
  return { results, saved }
}

/**
 * Remove the originals of the assets that were replaced, skipping any the
 * saved deck still names (another slide may use the same file, and the save
 * may have been rejected).
 */
async function deleteSuperseded(results) {
  const replaced = results.filter((r) => r.path && r.references > 0)
  if (replaced.length === 0) return
  const { html } = await fetchDeck()
  const saved = new DOMParser().parseFromString(html, 'text/html').documentElement
  for (const result of replaced) {
    if (hasReferenceTo(saved, result.source)) continue
    try {
      await deleteAsset(result.source.split('/').pop())
      result.deleted = true
    } catch (err) {
      // The deck is already on the new file; a leftover original only costs
      // disk space, so this is reported and does not fail the run.
      console.error(`could not delete the superseded ${result.source}:`, err)
      result.deleteError = String(err.message ?? err)
    }
  }
}
