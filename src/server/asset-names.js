// Naming for files in a deck's assets/ folder. Every asset is stored under
// `<stem>-<sha1[:8]><ext>`: identical bytes land on the same name, so
// storing the same file twice never accumulates copies, and changed bytes
// never reuse a name a browser may have cached.
import { createHash } from 'node:crypto'

/** `name` reduced to the characters an asset file name may contain. */
export function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 80)
}

/**
 * Content-addressed file name for `bytes`, built from `requested` (any
 * user-supplied name). `ext` overrides the extension of `requested`, and
 * `fallbackExt` applies when neither carries one.
 */
export function contentAddressedName(requested, bytes, { ext = '', fallbackExt = '.bin' } = {}) {
  const cleaned = safeName(requested || 'asset')
  const currentExt = /\.[^.]*$/.exec(cleaned)?.[0] ?? ''
  const stem = cleaned.replace(/\.[^.]*$/, '') || 'asset'
  const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 8)
  return `${stem}-${hash}${ext || currentExt || fallbackExt}`
}

/**
 * `stem` with a trailing content hash removed. Re-encoding an asset that is
 * already content-addressed would otherwise chain suffixes
 * (`photo-1a2b3c4d-5e6f7a8b.webp`).
 */
export function stripHashSuffix(stem) {
  return String(stem).replace(/-[0-9a-f]{8}$/, '') || String(stem)
}
