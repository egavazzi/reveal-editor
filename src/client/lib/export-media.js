// Drive the server's export encoder over a deck's media: one file at a time,
// at the size the slides show it, and report what came back so the exporter
// can embed the copies instead of the originals.
import { exportMediaCopy } from './api.js'
import { mediaPlan } from './model/media-plan.js'

/** The file name part of a deck-relative path, for messages. */
function fileLabel(path) {
  return path.split('/').pop() || path
}

/**
 * Re-encode everything the slides reference for an export at `preset`.
 * Resolves to:
 *
 * - `replacements` — a Map from the absolute URL of an original to
 *   `{ url, video }`, the URL to embed in its place. `video` marks a copy
 *   that is a video although the slide names it as an image (an animated
 *   GIF), which the exporter turns into a looping `<video>`.
 * - `summary` — `{ before, after, kept }`, the bytes the media weighed
 *   before and after and the files that were embedded unchanged, each as
 *   `{ name, reason, ssim? }`.
 *
 * Assets are encoded sequentially, so the machine stays usable and
 * `onProgress({ done, total, label })` can name the file in flight. A file
 * the server cannot encode fails the whole export: silently embedding the
 * original would hide the reason the file stayed large.
 */
export async function prepareExportMedia({
  slidesEl, baseUrl, preset, codec, scale = 1, slideWidth, slideHeight,
  onProgress = () => {}, signal
}) {
  const plan = mediaPlan({ slidesEl, scale, slideWidth, slideHeight })
  const replacements = new Map()
  const summary = { before: 0, after: 0, kept: [] }

  for (const [index, entry] of plan.entries()) {
    const label = `Compressing ${fileLabel(entry.path)}…`
    onProgress({ done: index, total: plan.length, label })
    let result
    try {
      result = await exportMediaCopy(entry.path, { preset, codec, target: entry.target }, {
        signal,
        onProgress: (fraction) => onProgress({ done: index + fraction, total: plan.length, label })
      })
    } catch (err) {
      console.error(`could not prepare ${entry.path} for the export:`, err)
      throw new Error(`${fileLabel(entry.path)}: ${err.message}`)
    }
    summary.before += result.before ?? 0
    // a file that is embedded unchanged still weighs what it weighed
    summary.after += (result.path ? result.after : result.before) ?? 0
    if (result.path) {
      for (const ref of entry.refs) {
        const resolved = absoluteUrl(ref, baseUrl)
        if (resolved) replacements.set(resolved, { url: result.path, video: Boolean(result.video) })
      }
    } else {
      summary.kept.push({ name: fileLabel(entry.path), reason: result.reason, ssim: result.ssim })
    }
  }
  onProgress({ done: plan.length, total: plan.length, label: 'Building the HTML…' })
  return { replacements, summary }
}

/** `reference` as the absolute URL the deck resolves it to, or null. */
function absoluteUrl(reference, baseUrl) {
  try {
    return new URL(String(reference).split('#')[0], baseUrl).href
  } catch {
    return null
  }
}
