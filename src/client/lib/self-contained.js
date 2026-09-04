import { editor, runtime } from '../stores/editor.svelte.js'
import { fetchDeck } from './api.js'
import { cleanSlides } from './model/clean.js'
import { deckDownloadName } from './filename.js'
import { formatSrcset, parseSrcset, splitFragment } from './media-refs.js'
import { THEME_LINK_SELECTOR } from './model/settings.js'

const SKIP_URL = /^(?:data:|javascript:|mailto:|tel:|#|$)/i

// `data-background` doubles as a colour slot and a URL slot. Values that read
// as a CSS colour are left alone; everything else is fetched and embedded.
const CSS_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var)\(.*\))$/i

// Anything larger than this makes a file no browser will happily open, and
// the base64 copies alone would exhaust the tab first.
const DEFAULT_MAX_BYTES = 250 * 1024 * 1024

function resourceUrl(value, baseUrl) {
  const raw = value?.trim()
  if (!raw || SKIP_URL.test(raw)) return null
  try {
    return new URL(raw, baseUrl).href
  } catch {
    return null
  }
}

function fileLabel(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'resource')
  } catch {
    return 'resource'
  }
}

function blobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function replaceAsync(value, pattern, replacer) {
  const matches = [...value.matchAll(pattern)]
  if (!matches.length) return value
  const replacements = await Promise.all(matches.map((match) => replacer(...match)))
  let result = ''
  let offset = 0
  matches.forEach((match, index) => {
    result += value.slice(offset, match.index) + replacements[index]
    offset = match.index + match[0].length
  })
  return result + value.slice(offset)
}

function progressContext(fetchImpl, onProgress, maxBytes) {
  const blobs = new Map()
  const dataUrls = new Map()
  let embeddedBytes = 0
  // `discovered` grows as resources are found, so the raw ratio can fall.
  // `reported` only ever rises, which is what the progress bar shows.
  let discovered = 1
  let finished = 0
  let reported = 0
  let label = 'Preparing presentation…'
  const emit = () => {
    reported = Math.max(reported, discovered ? finished / discovered : 0)
    onProgress?.({ done: reported * discovered, total: discovered, label })
  }
  emit()

  return {
    finishPreparation() {
      finished += 1
      emit()
    },
    async blob(url) {
      if (blobs.has(url)) return blobs.get(url)
      discovered += 1
      label = `Embedding ${fileLabel(url)}…`
      emit()
      const promise = (async () => {
        const response = await fetchImpl(url, { credentials: 'same-origin' })
        if (!response.ok) throw new Error(`could not fetch ${url} (${response.status})`)
        const blob = await response.blob()
        embeddedBytes += blob.size
        if (embeddedBytes > maxBytes) {
          throw new Error(`embedding ${fileLabel(url)} would exceed the ${Math.round(maxBytes / 1e6)} MB export budget`)
        }
        return blob
      })().finally(() => {
        finished += 1
        emit()
      })
      blobs.set(url, promise)
      return promise
    },
    /** The `data:` URL for a resource, built at most once per resource. */
    dataUrl(url) {
      if (!dataUrls.has(url)) {
        dataUrls.set(url, this.blob(url).then(blobAsDataUrl))
      }
      return dataUrls.get(url)
    },
    stage(next) {
      label = next
      emit()
    },
    complete() {
      finished = discovered
      reported = 1
      label = 'Finalizing HTML…'
      emit()
    }
  }
}

/**
 * The `data:` URL replacing `reference`, keeping any `#fragment` so that
 * `sprite.svg#icon` and `url(grid.svg#tile)` still select the same piece.
 */
async function embeddedUrl(reference, baseUrl, context) {
  const { resource, fragment } = splitFragment(reference?.trim() ?? '')
  const resolved = resourceUrl(resource, baseUrl)
  if (!resolved) return null
  return `${await context.dataUrl(resolved)}${fragment}`
}

async function inlineCss(css, cssUrl, context, chain = [cssUrl]) {
  // Inline imported styles before rewriting ordinary url(...) references so
  // an imported stylesheet's own relative font/image paths retain its base.
  css = await replaceAsync(
    css,
    /@import\s+(?:url\(\s*)?(?:(['"])(.*?)\1|([^'"\s);]+))\s*\)?\s*([^;]*);/gi,
    async (whole, _quote, quotedUrl, bareUrl, media) => {
      const resolved = resourceUrl(quotedUrl || bareUrl, cssUrl)
      if (!resolved) return whole
      if (chain.includes(resolved)) {
        throw new Error(`@import cycle: ${[...chain, resolved].map(fileLabel).join(' -> ')}`)
      }
      const imported = await (await context.blob(resolved)).text()
      const nested = await inlineCss(imported, resolved, context, [...chain, resolved])
      return media?.trim() ? `@media ${media.trim()} {\n${nested}\n}` : nested
    }
  )
  css = await replaceAsync(css, /url\(\s*(['"]?)(.*?)\1\s*\)/gi, async (whole, _quote, value) => {
    const embedded = await embeddedUrl(value, cssUrl, context)
    return embedded ? `url("${embedded}")` : whole
  })
  return css.replace(/^\s*@charset\s+[^;]+;/i, '')
}

async function inlineAttribute(element, attribute, baseUrl, context) {
  const embedded = await embeddedUrl(element.getAttribute(attribute), baseUrl, context)
  if (embedded) element.setAttribute(attribute, embedded)
}

async function inlineBackground(element, baseUrl, context) {
  const value = element.getAttribute('data-background')?.trim()
  if (!value || CSS_COLOR.test(value)) return
  await inlineAttribute(element, 'data-background', baseUrl, context)
}

async function inlineBackgroundVideo(element, baseUrl, context) {
  // reveal.js accepts a comma-separated list of sources here and plays the
  // first one the browser supports.
  const sources = (element.getAttribute('data-background-video') || '').split(',')
  const embedded = await Promise.all(sources.map(async (source) => {
    const trimmed = source.trim()
    if (!trimmed) return null
    return (await embeddedUrl(trimmed, baseUrl, context)) || trimmed
  }))
  const kept = embedded.filter(Boolean)
  if (kept.length) element.setAttribute('data-background-video', kept.join(','))
}

async function inlineSrcset(element, baseUrl, context) {
  const value = element.getAttribute('srcset')
  if (!value) return
  const embedded = await Promise.all(parseSrcset(value).map(async (candidate) => ({
    url: (await embeddedUrl(candidate.url, baseUrl, context)) || candidate.url,
    descriptor: candidate.descriptor
  })))
  element.setAttribute('srcset', formatSrcset(embedded))
}

async function inlineHtmlResource(element, attribute, baseUrl, context, depth) {
  const resolved = resourceUrl(element.getAttribute(attribute), baseUrl)
  if (!resolved) return
  if (depth >= 3) throw new Error(`nested iframe depth exceeds 3 at ${resolved}`)
  const response = await context.blob(resolved)
  const html = await response.text()
  const embedded = await inlineDocument(html, resolved, context, null, depth + 1)
  element.setAttribute(attribute, await blobAsDataUrl(new Blob([embedded], { type: 'text/html' })))
}

function katexRoot(document, baseUrl) {
  const scripts = [...document.querySelectorAll('script')].map((script) => script.textContent).join('\n')
  const match = scripts.match(/katex\s*:\s*\{[\s\S]*?local\s*:\s*(['"])(.*?)\1/)
  return new URL(`${(match?.[2] || 'reveal/katex').replace(/\/$/, '')}/`, baseUrl).href
}

async function embedKatex(document, baseUrl, context) {
  const scripts = [...document.querySelectorAll('script')]
  if (!scripts.some((script) => script.textContent.includes('RevealMath.KaTeX'))) {
    if (scripts.some((script) => /RevealMath\.MathJax\d?/.test(script.textContent))) {
      throw new Error('MathJax decks cannot be exported self-contained; switch the deck to KaTeX')
    }
    return
  }

  const root = katexRoot(document, baseUrl)
  const [css, katex, mhchem, autoRender] = await Promise.all([
    context.blob(new URL('dist/katex.min.css', root).href).then((blob) => blob.text()),
    context.blob(new URL('dist/katex.min.js', root).href).then((blob) => blob.text()),
    context.blob(new URL('dist/contrib/mhchem.min.js', root).href).then((blob) => blob.text()),
    context.blob(new URL('dist/contrib/auto-render.min.js', root).href).then((blob) => blob.text())
  ])

  const style = document.createElement('style')
  style.setAttribute('data-rip-embedded', 'katex')
  style.textContent = (await inlineCss(css, new URL('dist/katex.min.css', root).href, context))
    .replace(/<\/style/gi, '<\\/style')
  document.head.appendChild(style)

  for (const source of [katex, mhchem, autoRender]) {
    const script = document.createElement('script')
    script.setAttribute('data-rip-embedded', 'katex')
    script.textContent = source.replace(/<\/script/gi, '<\\/script')
    document.head.appendChild(script)
  }

  const plugin = document.createElement('script')
  plugin.setAttribute('data-rip-embedded', 'katex-plugin')
  plugin.textContent = `
window.RevealEmbeddedKaTeX = function () {
  var defaults = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\\\(', right: '\\\\)', display: false },
      { left: '\\\\[', right: '\\\\]', display: true }
    ],
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
  };
  return { id: 'katex', init: function (deck) {
    var configured = Object.assign({}, defaults, deck.getConfig().katex || {});
    delete configured.local; delete configured.version; delete configured.extensions;
    var render = function () {
      window.renderMathInElement(deck.getSlidesElement(), configured);
      deck.layout();
    };
    // The slides DOM already exists when plugins initialize. Render once now;
    // some Reveal builds dispatch ready before a factory plugin listener is
    // attached. Repeating at ready is harmless: KaTeX output has no authored
    // delimiters for auto-render to process again.
    render();
    if (!deck.isReady()) deck.on('ready', render);
  }};
};`
  document.head.appendChild(plugin)

  for (const script of scripts) {
    if (script.textContent.includes('RevealMath.KaTeX')) {
      script.textContent = script.textContent.replaceAll('RevealMath.KaTeX', 'RevealEmbeddedKaTeX')
    }
  }
}

async function inlineScripts(document, baseUrl, context) {
  const external = [...document.querySelectorAll('script[src]')]
  // A module's imports resolve against its own URL, which no longer exists
  // once the source is inlined; there is no correct rewrite for this.
  const modules = external.filter((script) => /(?:^|\s)module(?:\s|$)/i.test(script.getAttribute('type') || ''))
  if (modules.length) {
    throw new Error(`external module scripts cannot be embedded: ${modules.map((script) => script.getAttribute('src')).join(', ')}`)
  }
  // A head script that was deferred or async ran after parsing, so its code
  // may assume a complete body. Inlining makes it parser-blocking, so it has
  // to move to the end of the body to keep that guarantee.
  const deferred = external.filter((script) =>
    document.head.contains(script) && (script.hasAttribute('defer') || script.hasAttribute('async')))

  await Promise.all(external.map(async (script) => {
    const resolved = resourceUrl(script.getAttribute('src'), baseUrl)
    if (!resolved) return
    script.textContent = (await (await context.blob(resolved)).text()).replace(/<\/script/gi, '<\\/script')
    script.removeAttribute('src')
    script.removeAttribute('integrity')
    script.removeAttribute('crossorigin')
    script.removeAttribute('async')
    script.removeAttribute('defer')
  }))

  for (const script of deferred) document.body.appendChild(script)
}

/**
 * Point the theme stylesheet at `themeHref` before it is inlined. The deck's
 * bootstrap script swaps this link at load time to match the stored theme,
 * which it cannot do once the link has become a `<style>`, so the export has
 * to start from the theme the editor is currently showing.
 */
function applyThemeHref(document, themeHref, baseUrl) {
  if (!themeHref) return
  const link = document.querySelector(THEME_LINK_SELECTOR)
  if (!link) throw new Error('the deck has no theme stylesheet to export')
  link.setAttribute('href', new URL(themeHref, baseUrl).href)
}

async function inlineDocument(html, baseUrl, context, slidesHtml, depth = 0, themeHref = null) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  if (slidesHtml != null) {
    const slides = document.querySelector('.reveal .slides')
    if (!slides) throw new Error('could not locate the reveal.js slides element')
    slides.innerHTML = slidesHtml
  }

  const authoredBase = document.querySelector('base[href]')?.getAttribute('href')
  if (authoredBase) baseUrl = new URL(authoredBase, baseUrl).href
  document.querySelectorAll('base').forEach((base) => base.remove())

  applyThemeHref(document, themeHref, baseUrl)

  const stylesheets = [...document.querySelectorAll('link[rel~="stylesheet"][href]')]
  await Promise.all(stylesheets.map(async (link) => {
    const resolved = resourceUrl(link.getAttribute('href'), baseUrl)
    if (!resolved) return
    const css = await (await context.blob(resolved)).text()
    const style = document.createElement('style')
    // Marks the result as already inlined so the authored-<style> pass below
    // does not walk this stylesheet a second time.
    style.setAttribute('data-rip-embedded', 'stylesheet')
    style.textContent = (await inlineCss(css, resolved, context)).replace(/<\/style/gi, '<\\/style')
    for (const name of ['media', 'nonce', 'title']) {
      if (link.hasAttribute(name)) style.setAttribute(name, link.getAttribute(name))
    }
    link.replaceWith(style)
  }))

  await Promise.all([...document.querySelectorAll('style')].map(async (style) => {
    if (style.hasAttribute('data-rip-embedded')) return
    style.textContent = (await inlineCss(style.textContent, baseUrl, context)).replace(/<\/style/gi, '<\\/style')
  }))

  await inlineScripts(document, baseUrl, context)

  await embedKatex(document, baseUrl, context)

  const attributes = [
    ['img[src]', 'src'], ['video[src]', 'src'], ['video[poster]', 'poster'],
    ['audio[src]', 'src'], ['source[src]', 'src'], ['track[src]', 'src'],
    ['input[type="image"][src]', 'src'], ['object[data]', 'data'],
    ['image[href]', 'href'], ['image[xlink\\:href]', 'xlink:href'],
    ['use[href]', 'href'], ['use[xlink\\:href]', 'xlink:href'],
    ['link[rel~="icon"][href]', 'href'], ['link[rel~="preload"][href]', 'href'],
    ['[data-background-image]', 'data-background-image'],
    ['img[data-src]', 'data-src'], ['video[data-src]', 'data-src'],
    ['audio[data-src]', 'data-src'], ['source[data-src]', 'data-src']
  ]
  for (const [selector, attribute] of attributes) {
    await Promise.all([...document.querySelectorAll(selector)].map((element) =>
      inlineAttribute(element, attribute, baseUrl, context)))
  }

  await Promise.all([...document.querySelectorAll('[data-background]')].map((element) =>
    inlineBackground(element, baseUrl, context)))
  await Promise.all([...document.querySelectorAll('[data-background-video]')].map((element) =>
    inlineBackgroundVideo(element, baseUrl, context)))

  await Promise.all([...document.querySelectorAll('[srcset]')].map((element) =>
    inlineSrcset(element, baseUrl, context)))
  await Promise.all([...document.querySelectorAll('[style]')].map(async (element) => {
    element.setAttribute('style', await inlineCss(element.getAttribute('style'), baseUrl, context))
  }))

  for (const iframe of document.querySelectorAll('iframe[src]')) {
    await inlineHtmlResource(iframe, 'src', baseUrl, context, depth)
  }
  for (const section of document.querySelectorAll('[data-background-iframe]')) {
    await inlineHtmlResource(section, 'data-background-iframe', baseUrl, context, depth)
  }

  const doctype = document.doctype ? `<!doctype ${document.doctype.name}>\n` : '<!doctype html>\n'
  return doctype + document.documentElement.outerHTML
}

export async function buildSelfContainedHtml({
  html, slidesHtml = null, baseUrl, fetchImpl = fetch, onProgress,
  themeHref = null, maxBytes = DEFAULT_MAX_BYTES
}) {
  const context = progressContext(fetchImpl, onProgress, maxBytes)
  context.finishPreparation()
  const result = await inlineDocument(html, baseUrl, context, slidesHtml, 0, themeHref)
  context.complete()
  return result
}

export async function exportSelfContainedHtml() {
  if (!runtime.bridge) throw new Error('The deck is not ready yet.')
  const exportId = Date.now()
  editor.exportProgress = { id: exportId, done: 0, total: 1, label: 'Preparing presentation…' }
  try {
    const source = await fetchDeck()
    const html = await buildSelfContainedHtml({
      html: source.html,
      slidesHtml: cleanSlides(runtime.bridge.slidesEl),
      baseUrl: runtime.bridge.doc.baseURI,
      // The saved file may still name the previous theme; the live deck
      // carries the one the editor is showing.
      themeHref: runtime.bridge.doc.querySelector(THEME_LINK_SELECTOR)?.href ?? null,
      onProgress: (progress) => { editor.exportProgress = { id: exportId, ...progress } }
    })
    const href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `${deckDownloadName()}.html`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(href), 60_000)
    editor.statusMessage = `Downloaded self-contained HTML at ${new Date().toLocaleTimeString()}`
  } catch (err) {
    editor.statusMessage = `HTML export failed: ${err.message}`
    throw err
  } finally {
    setTimeout(() => {
      if (editor.exportProgress?.id === exportId) editor.exportProgress = null
    }, 1200)
  }
}
