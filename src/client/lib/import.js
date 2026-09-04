import { unzipSync } from 'fflate'
import { formatSrcset, parseSrcset, splitFragment } from './media-refs.js'

const MIME = {
  css: 'text/css', js: 'text/javascript', json: 'application/json', html: 'text/html', htm: 'text/html',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', avif: 'image/avif',
  svg: 'image/svg+xml', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf'
}

// `../` is deliberately left in place. Entry names keep it, references keep
// it, and both are resolved through `new URL(value, 'https://zip.invalid/…')`,
// which clamps at the origin root. A reference that climbs out of the archive
// therefore lands on a name no entry can have, and is reported as missing
// rather than reaching anything. Stripping `../` here would instead make
// `../../etc/passwd` resolve to a real entry.
function normalizeName(name) {
  return name.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function bytesToBase64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function mimeFor(name) {
  return MIME[name.split('.').pop().toLowerCase()] || 'application/octet-stream'
}

function baseName(name) {
  return name.split('/').pop() || name
}

// The archive is unpacked into memory and every asset becomes a data: URL,
// so the whole thing has to fit in the tab several times over.
const MAX_ENTRIES = 5000
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024

/** Import a conventional reveal.js ZIP without sending it to the server. */
export async function readDeckZip(file) {
  const unpacked = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const entries = Object.entries(unpacked)
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`The ZIP has ${entries.length} entries; at most ${MAX_ENTRIES} can be imported.`)
  }
  const unpackedBytes = entries.reduce((total, [, bytes]) => total + bytes.length, 0)
  if (unpackedBytes > MAX_UNPACKED_BYTES) {
    throw new Error(`The ZIP unpacks to ${Math.round(unpackedBytes / 1e6)} MB; at most ${Math.round(MAX_UNPACKED_BYTES / 1e6)} MB can be imported.`)
  }
  const files = new Map(entries.map(([name, bytes]) => [normalizeName(name), bytes]))
  const decoder = new TextDecoder()
  const candidates = [...files]
    .filter(([name]) => /\.html?$/i.test(name))
    .map(([name, bytes]) => ({ name, html: decoder.decode(bytes) }))
    .filter(({ html }) => /class\s*=\s*["'][^"']*\bslides\b/i.test(html) && /class\s*=\s*["'][^"']*\breveal\b/i.test(html))
    .sort((a, b) => (a.name.endsWith('deck.html') ? -1 : 0) - (b.name.endsWith('deck.html') ? -1 : 0) || a.name.length - b.name.length)
  if (!candidates.length) throw new Error('The ZIP does not contain a reveal.js HTML presentation.')

  const chosen = candidates[0]
  const cache = new Map()
  const unresolved = new Set()
  // Every reference in the document is rewritten, but only the `.slides`
  // subtree is imported: the deck's own shell replaces the head. A file the
  // archive is missing therefore only matters when a slide needs it.
  let collectMissing = false
  const missingReference = (reference) => {
    if (collectMissing) unresolved.add(reference)
  }

  // A ZIP packed from a folder holds everything under one directory, and a
  // deck inside it writes root-relative paths as if that directory were the
  // web root.
  const topLevel = new Set([...files.keys()].map((name) => name.split('/')[0]))
  const zipRoot = topLevel.size === 1 && [...files.keys()].every((name) => name.includes('/'))
    ? [...topLevel][0]
    : ''

  function resolveName(reference, fromName) {
    const value = reference.trim()
    if (!value || value.startsWith('#') || /^(?:data|blob|https?|mailto|tel|javascript):/i.test(value) || value.startsWith('//')) return null
    try {
      const url = value.startsWith('/') && zipRoot
        ? new URL(value.replace(/^\/+/, ''), `https://zip.invalid/${zipRoot}/`)
        : new URL(value, `https://zip.invalid/${normalizeName(fromName)}`)
      return normalizeName(decodeURIComponent(url.pathname))
    } catch {
      return null
    }
  }

  function cycle(chain, name) {
    return new Error(`@import cycle: ${[...chain, name].map(baseName).join(' -> ')}`)
  }

  function rewriteCss(css, fromName, chain) {
    // Imports are resolved first so that `@import url("x.css")` is treated as
    // an import rather than falling through to the plain url() branch.
    return css.replace(/@import\s+(?:url\(\s*)?(?:(['"])(.*?)\1|([^'"\s);]+))\s*\)?\s*([^;]*);/gi,
      (match, quote, quoted, bare, media) => {
        const reference = (quoted ?? bare).trim()
        const name = resolveName(reference, fromName)
        if (!name) return match
        const bytes = files.get(name)
        if (!bytes) {
          missingReference(reference)
          return match
        }
        if (chain.includes(name)) throw cycle(chain, name)
        const nested = rewriteCss(decoder.decode(bytes), name, [...chain, name])
        return `${media.trim() ? `@media ${media.trim()}{` : ''}${nested}${media.trim() ? '}' : ''}`
      }).replace(/url\(\s*(?:(['"])(.*?)\1|([^'"\s)][^)]*?))\s*\)/gi, (match, quote, quoted, bare) => {
      const embedded = embed((quoted ?? bare).trim(), fromName, chain)
      return embedded ? `url("${embedded}")` : match
    })
  }

  function embed(reference, fromName, chain = []) {
    // A `#fragment` selects a piece of the file — an SVG symbol, say — and
    // has to be carried onto the data: URL that replaces it.
    const { resource, fragment } = splitFragment(reference.trim())
    const name = resolveName(resource, fromName)
    if (!name) return null
    if (cache.has(name)) return cache.get(name) + fragment
    const bytes = files.get(name)
    if (!bytes) {
      missingReference(reference.trim())
      return null
    }
    if (chain.includes(name)) throw cycle(chain, name)
    let payload = bytes
    if (/\.css$/i.test(name)) {
      payload = new TextEncoder().encode(rewriteCss(decoder.decode(bytes), name, [...chain, name]))
    }
    const result = `data:${mimeFor(name)};base64,${bytesToBase64(payload)}`
    cache.set(name, result)
    return result + fragment
  }

  const doc = new DOMParser().parseFromString(chosen.html, 'text/html')
  const slides = doc.querySelector('.reveal .slides')
  const attributes = ['src', 'poster', 'data-src', 'data-background-image', 'data-background-video', 'data-background-iframe']
  for (const element of doc.querySelectorAll('*')) {
    collectMissing = Boolean(slides?.contains(element))
    for (const attribute of attributes) {
      if (!element.hasAttribute(attribute)) continue
      const embedded = embed(element.getAttribute(attribute), chosen.name)
      if (embedded) element.setAttribute(attribute, embedded)
    }
    if (element.hasAttribute('href') && /^(?:link|image|use)$/i.test(element.tagName)) {
      const embedded = embed(element.getAttribute('href'), chosen.name)
      if (embedded) element.setAttribute('href', embedded)
    }
    if (element.hasAttribute('srcset')) {
      element.setAttribute('srcset', formatSrcset(parseSrcset(element.getAttribute('srcset')).map((candidate) => ({
        url: embed(candidate.url, chosen.name) || candidate.url,
        descriptor: candidate.descriptor
      }))))
    }
    if (element.hasAttribute('style')) element.setAttribute('style', rewriteCss(element.getAttribute('style'), chosen.name, []))
  }
  for (const style of doc.querySelectorAll('style')) {
    collectMissing = Boolean(slides?.contains(style))
    style.textContent = rewriteCss(style.textContent, chosen.name, [])
  }

  if (unresolved.size) {
    const missing = [...unresolved]
    throw new Error(`The presentation references files that are not in it: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? `, and ${missing.length - 5} more` : ''}.`)
  }

  // Keep the imported document independent of the ZIP's original folder name.
  doc.querySelector('base')?.remove()
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}
