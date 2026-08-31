import { editor, runtime } from '../stores/editor.svelte.js'
import { fetchDeck } from './api.js'
import { cleanSlides } from './model/clean.js'

const SKIP_URL = /^(?:data:|javascript:|mailto:|tel:|#|$)/i

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

function progressContext(fetchImpl, onProgress) {
  const blobs = new Map()
  let done = 0
  let total = 1
  let label = 'Preparing presentation…'
  const emit = () => onProgress?.({ done, total, label })
  emit()

  return {
    finishPreparation() {
      done++
      emit()
    },
    async blob(url) {
      if (blobs.has(url)) return blobs.get(url)
      total++
      label = `Embedding ${fileLabel(url)}…`
      emit()
      const promise = (async () => {
        const response = await fetchImpl(url, { credentials: 'same-origin' })
        if (!response.ok) throw new Error(`could not fetch ${url} (${response.status})`)
        return response.blob()
      })().finally(() => {
        done++
        emit()
      })
      blobs.set(url, promise)
      return promise
    },
    stage(next) {
      label = next
      emit()
    },
    complete() {
      done = total
      label = 'Finalizing HTML…'
      emit()
    }
  }
}

async function inlineCss(css, cssUrl, context) {
  // Inline imported styles before rewriting ordinary url(...) references so
  // an imported stylesheet's own relative font/image paths retain its base.
  css = await replaceAsync(
    css,
    /@import\s+(?:url\(\s*)?(?:(['"])(.*?)\1|([^'"\s);]+))\s*\)?\s*([^;]*);/gi,
    async (whole, _quote, quotedUrl, bareUrl, media) => {
      const resolved = resourceUrl(quotedUrl || bareUrl, cssUrl)
      if (!resolved) return whole
      const imported = await (await context.blob(resolved)).text()
      const nested = await inlineCss(imported, resolved, context)
      return media?.trim() ? `@media ${media.trim()} {\n${nested}\n}` : nested
    }
  )
  css = await replaceAsync(css, /url\(\s*(['"]?)(.*?)\1\s*\)/gi, async (whole, _quote, value) => {
    const resolved = resourceUrl(value, cssUrl)
    if (!resolved) return whole
    return `url("${await blobAsDataUrl(await context.blob(resolved))}")`
  })
  return css.replace(/^\s*@charset\s+[^;]+;/i, '')
}

async function inlineAttribute(element, attribute, baseUrl, context) {
  const value = element.getAttribute(attribute)
  const resolved = resourceUrl(value, baseUrl)
  if (!resolved) return
  element.setAttribute(attribute, await blobAsDataUrl(await context.blob(resolved)))
}

async function inlineSrcset(element, baseUrl, context) {
  const value = element.getAttribute('srcset')
  if (!value) return
  const candidates = value.split(/,\s+(?=[^,]+(?:\s|$))/)
  const embedded = await Promise.all(candidates.map(async (candidate) => {
    const match = candidate.trim().match(/^(\S+)(\s+.+)?$/)
    if (!match) return candidate
    const resolved = resourceUrl(match[1], baseUrl)
    if (!resolved) return candidate
    return `${await blobAsDataUrl(await context.blob(resolved))}${match[2] || ''}`
  }))
  element.setAttribute('srcset', embedded.join(', '))
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
  if (!scripts.some((script) => script.textContent.includes('RevealMath.KaTeX'))) return

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

async function inlineDocument(html, baseUrl, context, slidesHtml, depth = 0) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  if (slidesHtml != null) {
    const slides = document.querySelector('.reveal .slides')
    if (!slides) throw new Error('could not locate the reveal.js slides element')
    slides.innerHTML = slidesHtml
  }

  const authoredBase = document.querySelector('base[href]')?.getAttribute('href')
  if (authoredBase) baseUrl = new URL(authoredBase, baseUrl).href
  document.querySelectorAll('base').forEach((base) => base.remove())

  const stylesheets = [...document.querySelectorAll('link[rel~="stylesheet"][href]')]
  await Promise.all(stylesheets.map(async (link) => {
    const resolved = resourceUrl(link.getAttribute('href'), baseUrl)
    if (!resolved) return
    const css = await (await context.blob(resolved)).text()
    const style = document.createElement('style')
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

  await Promise.all([...document.querySelectorAll('script[src]')].map(async (script) => {
    const resolved = resourceUrl(script.getAttribute('src'), baseUrl)
    if (!resolved) return
    script.textContent = (await (await context.blob(resolved)).text()).replace(/<\/script/gi, '<\\/script')
    script.removeAttribute('src')
    script.removeAttribute('integrity')
    script.removeAttribute('crossorigin')
    script.removeAttribute('async')
    script.removeAttribute('defer')
  }))

  await embedKatex(document, baseUrl, context)

  const attributes = [
    ['img[src]', 'src'], ['video[src]', 'src'], ['video[poster]', 'poster'],
    ['audio[src]', 'src'], ['source[src]', 'src'], ['track[src]', 'src'],
    ['input[type="image"][src]', 'src'], ['object[data]', 'data'],
    ['image[href]', 'href'], ['image[xlink\\:href]', 'xlink:href'],
    ['link[rel~="icon"][href]', 'href'], ['link[rel~="preload"][href]', 'href'],
    ['[data-background-image]', 'data-background-image'],
    ['img[data-src]', 'data-src'], ['video[data-src]', 'data-src'],
    ['audio[data-src]', 'data-src'], ['source[data-src]', 'data-src']
  ]
  for (const [selector, attribute] of attributes) {
    await Promise.all([...document.querySelectorAll(selector)].map((element) =>
      inlineAttribute(element, attribute, baseUrl, context)))
  }

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
  html, slidesHtml = null, baseUrl, fetchImpl = fetch, onProgress
}) {
  const context = progressContext(fetchImpl, onProgress)
  context.finishPreparation()
  const result = await inlineDocument(html, baseUrl, context, slidesHtml)
  context.complete()
  return result
}

function safeName() {
  return (editor.deckFile || 'presentation').replace(/\.html?$/i, '').replace(/[^a-z0-9._-]+/gi, '-')
}

export async function exportSelfContainedHtml() {
  if (!runtime.bridge) return
  const exportId = Date.now()
  editor.exportProgress = { id: exportId, done: 0, total: 1, label: 'Preparing presentation…' }
  try {
    const source = await fetchDeck()
    const html = await buildSelfContainedHtml({
      html: source.html,
      slidesHtml: cleanSlides(runtime.bridge.slidesEl),
      baseUrl: runtime.bridge.doc.baseURI,
      onProgress: (progress) => { editor.exportProgress = { id: exportId, ...progress } }
    })
    const href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `${safeName()}.html`
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
