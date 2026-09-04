import { unzipSync } from 'fflate'

const MIME = {
  css: 'text/css', js: 'text/javascript', json: 'application/json', html: 'text/html', htm: 'text/html',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', avif: 'image/avif',
  svg: 'image/svg+xml', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf'
}

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

/** Import a conventional reveal.js ZIP without sending it to the server. */
export async function readDeckZip(file) {
  const unpacked = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const files = new Map(Object.entries(unpacked).map(([name, bytes]) => [normalizeName(name), bytes]))
  const decoder = new TextDecoder()
  const candidates = [...files]
    .filter(([name]) => /\.html?$/i.test(name))
    .map(([name, bytes]) => ({ name, html: decoder.decode(bytes) }))
    .filter(({ html }) => /class\s*=\s*["'][^"']*\bslides\b/i.test(html) && /class\s*=\s*["'][^"']*\breveal\b/i.test(html))
    .sort((a, b) => (a.name.endsWith('deck.html') ? -1 : 0) - (b.name.endsWith('deck.html') ? -1 : 0) || a.name.length - b.name.length)
  if (!candidates.length) throw new Error('The ZIP does not contain a reveal.js HTML presentation.')

  const chosen = candidates[0]
  const cache = new Map()

  function resolveName(reference, fromName) {
    const value = reference.trim()
    if (!value || value.startsWith('#') || /^(?:data|blob|https?|mailto|tel|javascript):/i.test(value) || value.startsWith('//')) return null
    try {
      const url = new URL(value, `https://zip.invalid/${normalizeName(fromName)}`)
      return normalizeName(decodeURIComponent(url.pathname))
    } catch {
      return null
    }
  }

  function rewriteCss(css, fromName, stack) {
    return css.replace(/url\(\s*(?:(['"])(.*?)\1|([^'"\s)][^)]*?))\s*\)/gi, (match, quote, quoted, bare) => {
      const reference = (quoted ?? bare).trim()
      const embedded = embed(reference, fromName, stack)
      return embedded ? `url("${embedded}")` : match
    }).replace(/@import\s+(?:url\(\s*)?(?:(['"])(.*?)\1|([^'"\s);]+))\s*\)?\s*([^;]*);/gi,
      (match, quote, quoted, bare, media) => {
        const name = resolveName(quoted ?? bare, fromName)
        const bytes = name && files.get(name)
        if (!bytes || stack.has(name)) return match
        const nested = rewriteCss(decoder.decode(bytes), name, new Set([...stack, name]))
        return `${media.trim() ? `@media ${media.trim()}{` : ''}${nested}${media.trim() ? '}' : ''}`
      })
  }

  function embed(reference, fromName, stack = new Set()) {
    const name = resolveName(reference, fromName)
    const bytes = name && files.get(name)
    if (!bytes || stack.has(name)) return null
    if (cache.has(name)) return cache.get(name)
    let payload = bytes
    if (/\.css$/i.test(name)) {
      payload = new TextEncoder().encode(rewriteCss(decoder.decode(bytes), name, new Set([...stack, name])))
    }
    const result = `data:${mimeFor(name)};base64,${bytesToBase64(payload)}`
    cache.set(name, result)
    return result
  }

  const doc = new DOMParser().parseFromString(chosen.html, 'text/html')
  const attributes = ['src', 'poster', 'data-src', 'data-background-image', 'data-background-video', 'data-background-iframe']
  for (const element of doc.querySelectorAll('*')) {
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
      const rewritten = element.getAttribute('srcset').split(',').map((candidate) => {
        const match = candidate.trim().match(/^(\S+)(\s+.*)?$/)
        if (!match) return candidate
        return `${embed(match[1], chosen.name) || match[1]}${match[2] || ''}`
      }).join(', ')
      element.setAttribute('srcset', rewritten)
    }
    if (element.hasAttribute('style')) element.setAttribute('style', rewriteCss(element.getAttribute('style'), chosen.name, new Set()))
  }
  for (const style of doc.querySelectorAll('style')) style.textContent = rewriteCss(style.textContent, chosen.name, new Set())

  // Keep the imported document independent of the ZIP's original folder name.
  doc.querySelector('base')?.remove()
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}
