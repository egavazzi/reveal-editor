// Math and code source editing. Both keep the FILE form as plain authored
// source (raw LaTeX with delimiters / raw code text) while the LIVE form is
// the rendered KaTeX / highlighted markup. Rendering uses the deck's own
// plugins inside the iframe, so what you see is exactly what presents.
import { restoreMath } from '../model/clean.js'
import { CODE_SRC_ATTR } from '../model/stash.js'

// Delimiters the deck's KaTeX auto-render understands. We render inline
// \( \) and display $$ $$ — matching what the save cleaner emits.
const DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '\\(', right: '\\)', display: false },
  { left: '\\[', right: '\\]', display: true }
]

export function canRenderMath(bridge) {
  return typeof bridge.win.renderMathInElement === 'function'
}

export function renderMath(bridge, el) {
  if (canRenderMath(bridge)) {
    bridge.win.renderMathInElement(el, { delimiters: DELIMITERS, throwOnError: false })
  }
}

/**
 * True when an element's content is purely text + math (no other markup),
 * so the plain-text math editor can round-trip it without data loss.
 */
export function isMathOnly(el) {
  const clone = el.cloneNode(true)
  restoreMath(clone)
  return clone.querySelector('*') === null
}

/** The authored LaTeX source of an element (delimited), from live DOM. */
export function getMathSource(el) {
  const clone = el.cloneNode(true)
  restoreMath(clone)
  return clone.textContent
}

export function commitMath(bridge, el, source) {
  el.textContent = source
  renderMath(bridge, el)
}

export function getCodeState(el) {
  const code = el.querySelector('code') ?? el
  const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice(9) ?? ''
  const stashed = code.getAttribute(CODE_SRC_ATTR)
  let source
  if (stashed != null) {
    const tmp = el.ownerDocument.createElement('div')
    tmp.innerHTML = stashed
    source = tmp.textContent
  } else {
    source = code.textContent
  }
  return { code, lang, source }
}

export function commitCode(bridge, el, source, lang) {
  const code = el.querySelector('code') ?? el
  code.textContent = source
  for (const c of [...code.classList]) {
    if (c.startsWith('language-') || c === 'hljs') code.classList.remove(c)
  }
  if (lang) code.classList.add(`language-${lang}`)
  if (!code.classList.length) code.removeAttribute('class')
  code.setAttribute(CODE_SRC_ATTR, code.innerHTML)
  code.removeAttribute('data-highlighted')
  const hljs = bridge.Reveal.getPlugin?.('highlight')?.hljs
  if (hljs && lang) hljs.highlightElement(code)
}
