// Save cleaner: turns the live (reveal-mutated, editor-decorated) .slides
// DOM back into the clean markup that belongs in the deck file. Works on a
// clone — never touches the live DOM. The output innerHTML is sent to the
// server, which formats it deterministically and splices it into the file.
import { CODE_SRC_ATTR, FRAG_AUTO_ATTR } from './stash.js'

// Classes reveal.js adds to sections/fragments at runtime.
const RUNTIME_SECTION_CLASSES = [
  'past', 'present', 'future', 'stack', 'overflowing',
  'has-light-background', 'has-dark-background'
]
const RUNTIME_FRAGMENT_CLASSES = ['visible', 'current-fragment']
// Classes highlight.js adds to code elements at runtime.
const RUNTIME_CODE_CLASSES = ['hljs']
// Classes reveal's highlight plugin adds to <pre> at runtime.
const RUNTIME_PRE_CLASSES = ['code-wrapper']

// Editor-transient attributes, stripped from every element. Deliberately
// does NOT include contenteditable: the rich-text editor removes its own
// artifacts on detach, and foreign decks may author contenteditable.
const TRANSIENT_ATTRS = [
  CODE_SRC_ATTR, FRAG_AUTO_ATTR, 'data-re-selected', 'data-highlighted', 'data-re-group-child',
  // reveal.js marks media it paused at runtime; never ours to save
  'data-paused-by-reveal'
]

// Editor-injected elements that must never reach the file.
const EDITOR_ELEMENT_SELECTOR = [
  '.re-transient',
  '.moveable-control-box',
  '.selecto-selection'
].join(', ')

function removeClasses(el, classes) {
  el.classList.remove(...classes)
  if (el.classList.length === 0) el.removeAttribute('class')
}

function removeStyleProps(el, props) {
  if (!el.getAttribute('style')) return
  for (const p of props) el.style.removeProperty(p)
  if (!el.getAttribute('style')?.trim()) el.removeAttribute('style')
}

function cleanSection(section) {
  removeClasses(section, RUNTIME_SECTION_CLASSES)
  section.removeAttribute('hidden')
  section.removeAttribute('aria-hidden')
  section.removeAttribute('data-fragment')
  removeStyleProps(section, ['display', 'top'])
}

/**
 * KaTeX auto-render wraps every expression it renders in an anonymous span of
 * its own, and a re-render can nest another one outside that. Replacing those
 * wrappers — not just the .katex node inside them — is what keeps a box of
 * mixed text and math from gaining a span layer on every render/save cycle.
 * Only bare spans holding this one expression and nothing else count as
 * wrappers; any attribute means the span is the author's, and it stays.
 */
function mathHost(node) {
  let host = node
  for (;;) {
    const parent = host.parentElement
    const isWrapper = parent != null &&
      parent.tagName === 'SPAN' &&
      parent.attributes.length === 0 &&
      parent.childElementCount === 1 &&
      parent.textContent === host.textContent
    if (!isWrapper) return host
    host = parent
  }
}

export function restoreMath(root) {
  // KaTeX keeps the original TeX in a MathML annotation; restore the
  // delimited source text. Delimiters normalize to \( \) inline, $$ $$
  // display (documented in README) — authored $ … $ comes back as \( … \).
  const replace = (node, source) => {
    mathHost(node).replaceWith(root.ownerDocument.createTextNode(source))
  }
  for (const display of root.querySelectorAll('.katex-display')) {
    const tex = display.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (tex != null) replace(display, `$$${tex}$$`)
  }
  for (const inline of root.querySelectorAll('.katex')) {
    const tex = inline.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (tex != null) replace(inline, `\\(${tex}\\)`)
  }
  // Restoring leaves the source split across adjacent text nodes; a math box
  // whose contract is plain text must end up as exactly one of them.
  root.normalize()
}

function restoreCode(root) {
  for (const code of root.querySelectorAll('pre > code')) {
    const src = code.getAttribute(CODE_SRC_ATTR)
    if (src != null) code.innerHTML = src
    removeClasses(code, RUNTIME_CODE_CLASSES)
    code.removeAttribute('tabindex')
  }
  for (const pre of root.querySelectorAll('pre')) {
    removeClasses(pre, RUNTIME_PRE_CLASSES)
  }
}

function cleanFragments(root) {
  for (const frag of root.querySelectorAll('.fragment')) {
    removeClasses(frag, RUNTIME_FRAGMENT_CLASSES)
    if (frag.hasAttribute(FRAG_AUTO_ATTR)) frag.removeAttribute('data-fragment-index')
  }
}

function stripLazyLoading(root) {
  // reveal.js moves data-src to src while an asset is loaded and marks the
  // element so it can reverse that mutation when the slide is unloaded.
  for (const el of root.querySelectorAll('[data-lazy-loaded]')) {
    if (el.hasAttribute('src')) {
      el.setAttribute('data-src', el.getAttribute('src'))
      el.removeAttribute('src')
    }
    el.removeAttribute('data-lazy-loaded')
  }
}

function cleanContainer(container) {
  for (const el of container.querySelectorAll(EDITOR_ELEMENT_SELECTOR)) el.remove()

  // crop mode may be live while saving; its marker class is runtime-only
  for (const el of container.querySelectorAll('.re-cropping')) removeClasses(el, ['re-cropping'])

  for (const section of container.querySelectorAll('section')) cleanSection(section)
  cleanFragments(container)
  restoreCode(container)
  restoreMath(container)
  stripLazyLoading(container)

  for (const el of container.querySelectorAll('*')) {
    for (const attr of TRANSIENT_ATTRS) el.removeAttribute(attr)
  }
}

/**
 * Produce the clean innerHTML for the deck file from the live .slides element.
 */
export function cleanSlides(liveSlidesEl) {
  const clone = liveSlidesEl.cloneNode(true)
  cleanContainer(clone)
  return clone.innerHTML
}

/** Clean outerHTML of a single live element (history snapshots, clipboard). */
export function cleanElementHtml(el) {
  const container = el.ownerDocument.createElement('div')
  container.appendChild(el.cloneNode(true))
  cleanContainer(container)
  return container.innerHTML
}
