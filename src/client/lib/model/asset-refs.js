// Every place a slide can name a media file, in one module, so that a pass
// over the deck's media (sizing it for an export, say) sees all of them.
//
// Saved decks carry media under `data-src` as well as `src` (reveal.js lazy
// loading), so both forms are always handled.

import { parseSrcset } from '../media-refs.js'

// Attributes whose whole value is one URL.
const SINGLE_URL_ATTRS = ['src', 'data-src', 'poster', 'data-background-image']

// reveal.js accepts a comma-separated list of sources here.
const LIST_URL_ATTRS = ['data-background-video']

const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi

/**
 * A path as it identifies a file: query and fragment removed, percent
 * escapes decoded, and a leading `./` or `/deck/` dropped. Returns '' for
 * anything that is not a deck-relative reference (a data:, blob: or remote
 * URL).
 */
export function normalizeAssetPath(value) {
  const raw = String(value ?? '').trim()
  if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) return ''
  const withoutQuery = raw.split(/[?#]/)[0]
  let decoded
  try {
    decoded = decodeURIComponent(withoutQuery)
  } catch {
    decoded = withoutQuery
  }
  return decoded.replace(/^\.\//, '').replace(/^\/deck\//, '')
}

/** Whether two references name the same deck file. */
export function samePath(a, b) {
  const left = normalizeAssetPath(a)
  return left !== '' && left === normalizeAssetPath(b)
}

/**
 * Every reference to a deck file under `root`, as
 * `{ element, attribute, kind, raw, path }` — `kind` is 'attribute' for a
 * single URL, 'list' for one entry of a comma-separated attribute, 'srcset'
 * for one candidate of a `srcset`, and 'style' for a CSS `url()` in a style
 * attribute. `raw` is the reference as written, which resolves against the
 * deck's base URL; `path` identifies the file. Frame and crop decoration
 * attributes are not references and are left out.
 */
export function assetReferences(root) {
  const found = []
  const elements = [root, ...root.querySelectorAll('*')].filter((el) => el?.nodeType === 1)
  for (const element of elements) {
    for (const attribute of SINGLE_URL_ATTRS) {
      const raw = element.getAttribute?.(attribute)
      const path = normalizeAssetPath(raw)
      if (path) found.push({ element, attribute, kind: 'attribute', raw, path })
    }
    for (const attribute of LIST_URL_ATTRS) {
      const value = element.getAttribute?.(attribute)
      if (!value) continue
      for (const entry of value.split(',')) {
        const path = normalizeAssetPath(entry)
        if (path) found.push({ element, attribute, kind: 'list', raw: entry.trim(), path })
      }
    }
    const srcset = element.getAttribute?.('srcset')
    if (srcset) {
      for (const candidate of parseSrcset(srcset)) {
        const path = normalizeAssetPath(candidate.url)
        if (path) found.push({ element, attribute: 'srcset', kind: 'srcset', raw: candidate.url, path })
      }
    }
    const style = element.getAttribute?.('style')
    if (style) {
      for (const [, , url] of style.matchAll(CSS_URL)) {
        const path = normalizeAssetPath(url)
        if (path) found.push({ element, attribute: 'style', kind: 'style', raw: url, path })
      }
    }
  }
  return found
}
