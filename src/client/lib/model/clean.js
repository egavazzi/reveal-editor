// Save cleaner: turns the live (reveal-mutated, editor-decorated) .slides
// DOM back into the clean markup that belongs in the deck file. Works on a
// clone — never touches the live DOM. The output innerHTML is sent to the
// server, which formats it deterministically and splices it into the file.
import { CODE_SRC_ATTR, FRAG_AUTO_ATTR } from './stash.js'

// Classes reveal.js adds to sections/fragments at runtime.
const RUNTIME_SECTION_CLASSES = ['past', 'present', 'future', 'stack', 'overflowing']
const RUNTIME_FRAGMENT_CLASSES = ['visible', 'current-fragment']
// Classes highlight.js adds to code elements at runtime.
const RUNTIME_CODE_CLASSES = ['hljs']

// Editor-transient attributes, stripped from every element. Deliberately
// does NOT include contenteditable: the rich-text editor removes its own
// artifacts on detach, and foreign decks may author contenteditable.
const TRANSIENT_ATTRS = [
  CODE_SRC_ATTR, FRAG_AUTO_ATTR, 'data-re-selected', 'data-highlighted'
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

function restoreMath(root) {
  // KaTeX keeps the original TeX in a MathML annotation; restore the
  // delimited source text. Delimiters normalize to \( \) inline, $$ $$
  // display (documented in README).
  for (const display of root.querySelectorAll('.katex-display')) {
    const tex = display.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (tex != null) display.replaceWith(root.ownerDocument.createTextNode(`$$${tex}$$`))
  }
  for (const inline of root.querySelectorAll('.katex')) {
    const tex = inline.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (tex != null) inline.replaceWith(root.ownerDocument.createTextNode(`\\(${tex}\\)`))
  }
}

function restoreCode(root) {
  for (const code of root.querySelectorAll('pre > code')) {
    const src = code.getAttribute(CODE_SRC_ATTR)
    if (src != null) code.innerHTML = src
    removeClasses(code, RUNTIME_CODE_CLASSES)
  }
}

function cleanFragments(root) {
  for (const frag of root.querySelectorAll('.fragment')) {
    removeClasses(frag, RUNTIME_FRAGMENT_CLASSES)
    if (frag.hasAttribute(FRAG_AUTO_ATTR)) frag.removeAttribute('data-fragment-index')
  }
}

function stripLazyLoading(root) {
  for (const el of root.querySelectorAll('[data-src][src]')) {
    el.removeAttribute('src')
  }
}

/**
 * Produce the clean innerHTML for the deck file from the live .slides element.
 */
export function cleanSlides(liveSlidesEl) {
  const clone = liveSlidesEl.cloneNode(true)

  for (const el of clone.querySelectorAll(EDITOR_ELEMENT_SELECTOR)) el.remove()

  for (const section of clone.querySelectorAll('section')) cleanSection(section)
  cleanFragments(clone)
  restoreCode(clone)
  restoreMath(clone)
  stripLazyLoading(clone)

  for (const el of clone.querySelectorAll('*')) {
    for (const attr of TRANSIENT_ATTRS) el.removeAttribute(attr)
  }

  return clone.innerHTML
}
