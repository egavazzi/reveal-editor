// In-place rich text editing via contenteditable on the actual slide
// element — no wrapper, no editor scaffolding in the DOM, so the save
// round-trip stays clean by construction. Formatting commands use
// execCommand with styleWithCSS off, which produces plain semantic tags
// (<b>, <i>, <ul>…) that are exactly what belongs in the file.
//
// Math mixes into ordinary prose the same way it does in the file: the box
// holds delimited LaTeX ($ … $, \( … \), $$ … $$) as plain text, and the
// deck's own KaTeX renders it. Rendered KaTeX is a deep tree of spans that
// contenteditable would happily let the user type into and destroy, so an
// edit session swaps the box back to its source form on entry and re-renders
// it on commit — the same two forms the rest of the editor already uses.
import { renderMath, showMathSource } from './mathcode.js'

let active = null

export function isEditingText() {
  return active !== null
}

export function activeElement() {
  return active?.el ?? null
}

export function startTextEdit(el, bridge, { onDone } = {}) {
  if (active) stopTextEdit()
  const doc = bridge.doc
  doc.execCommand('styleWithCSS', false, false)
  showMathSource(el)
  el.setAttribute('contenteditable', 'true')
  el.setAttribute('spellcheck', 'false')
  el.focus()

  // Focus moving into editor chrome marked [data-keep-text-edit] (the format
  // bar's select/inputs) must not commit the edit — those controls act on the
  // live text selection. Blur order is unreliable, so check after a tick.
  // The session token (not the element) identifies the edit: setBlockStyle
  // may retag the edited element mid-session.
  const session = {}
  const finish = () => {
    setTimeout(() => {
      if (!active || active.session !== session) return
      if (document.activeElement?.closest?.('[data-keep-text-edit]')) return
      stopTextEdit()
    }, 0)
  }
  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      stopTextEdit()
    }
    // Keep editor-level shortcuts (delete element, undo…) out of typing,
    // but let Ctrl+S bubble to the save handler.
    if (!((e.ctrlKey || e.metaKey) && e.key === 's')) e.stopPropagation()
  }
  // blur alone is unreliable (focus may sit outside the iframe); any
  // pointer-down outside the element also commits the edit.
  const onDocMousedown = (e) => {
    if (!active?.el.contains(e.target)) stopTextEdit()
  }
  // Clicks on editor chrome (parent document) outside the keep-edit zone
  // also commit — the iframe's blur may already have been swallowed above.
  const onParentMousedown = (e) => {
    if (!e.target.closest?.('[data-keep-text-edit]')) stopTextEdit()
  }
  el.addEventListener('blur', finish)
  el.addEventListener('keydown', onKeydown)
  doc.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('mousedown', onParentMousedown, true)

  active = { el, bridge, onDone, finish, onKeydown, onDocMousedown, onParentMousedown, doc, session }
  return active
}

export function stopTextEdit() {
  if (!active) return
  const { el, bridge, onDone, finish, onKeydown, onDocMousedown, onParentMousedown, doc } = active
  active = null
  el.removeEventListener('blur', finish)
  el.removeEventListener('keydown', onKeydown)
  doc.removeEventListener('mousedown', onDocMousedown, true)
  document.removeEventListener('mousedown', onParentMousedown, true)
  el.removeAttribute('contenteditable')
  el.removeAttribute('spellcheck')
  cleanupMarkup(el)
  const removed = maybeRemoveEmpty(el)
  // after the markup cleanup, so KaTeX's own spans are never its business
  if (!removed) renderMath(bridge, el)
  onDone?.({ el, removed })
}

/**
 * Wrap the selected text (or open an empty pair at the caret) in inline math
 * delimiters. Plain text insertion — the box is in source form for as long as
 * the edit lasts, so this is all it takes; committing renders it.
 */
export function insertInlineMath() {
  if (!active) return
  const { bridge, doc, el } = active
  const sel = bridge.win.getSelection()
  const selected = sel && !sel.isCollapsed ? sel.toString() : ''
  doc.execCommand('insertText', false, `\\(${selected}\\)`)
  // With nothing selected the caret lands after the closing delimiter; put it
  // between the two so the next keystroke is the formula.
  if (!selected) {
    const node = sel?.anchorNode
    if (node?.nodeType === 3 && sel.anchorOffset >= 2) {
      const range = doc.createRange()
      range.setStart(node, sel.anchorOffset - 2)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }
  el.focus()
}

// Commands whose semantic-tag output is deprecated markup (<font>, align="")
// use CSS styling instead; everything else stays plain tags (<b>, <ul>…).
const CSS_COMMANDS = ['foreColor', 'fontSize', 'fontName', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull']

/** Apply a formatting command to the current text selection. */
export function formatText(command, value = null) {
  if (!active) return
  const doc = active.bridge.doc
  doc.execCommand('styleWithCSS', false, CSS_COMMANDS.includes(command))
  doc.execCommand(command, false, value)
  active.el.focus()
}

const BLOCK_TAGS = ['h1', 'h2', 'h3', 'h4', 'blockquote']
const BLOCK_HOST_TAGS = [...BLOCK_TAGS, 'h5', 'h6', 'p']

/**
 * Change the paragraph style at the caret. When the edited element itself is
 * the block (layout headings are bare <h1>/<h2> hosts), retag the host in
 * place — execCommand('formatBlock') would nest a new block inside it.
 */
export function setBlockStyle(tag) {
  if (!active) return
  const host = active.el
  const sel = active.bridge.win.getSelection()
  const anchor = sel?.anchorNode
  const anchorEl = anchor ? (anchor.nodeType === 1 ? anchor : anchor.parentElement) : null
  const inner = anchorEl && anchorEl !== host && host.contains(anchorEl)
    ? anchorEl.closest('h1, h2, h3, h4, h5, h6, blockquote, p, li')
    : null
  if ((inner && inner !== host && host.contains(inner)) ||
      !BLOCK_HOST_TAGS.includes(host.tagName.toLowerCase())) {
    formatText('formatBlock', `<${tag}>`)
    return
  }
  if (host.tagName.toLowerCase() === tag) return
  // retag the host, preserving attributes, children, caret and edit session
  const doc = active.bridge.doc
  const next = doc.createElement(tag)
  for (const attr of host.attributes) next.setAttribute(attr.name, attr.value)
  const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
  next.append(...host.childNodes)
  host.replaceWith(next)
  host.removeEventListener('blur', active.finish)
  host.removeEventListener('keydown', active.onKeydown)
  next.addEventListener('blur', active.finish)
  next.addEventListener('keydown', active.onKeydown)
  active.el = next
  next.focus()
  if (range) {
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

/** Snapshot of the formatting state at the caret, for toolbar highlighting. */
export function queryFormatState() {
  if (!active) return null
  const doc = active.doc
  const read = (command) => {
    try { return doc.queryCommandState(command) } catch { return false }
  }
  let block = ''
  try { block = String(doc.queryCommandValue('formatBlock') || '').toLowerCase() } catch { /* ignore */ }
  const win = active.bridge.win
  const anchor = win.getSelection()?.anchorNode
  const sizeEl = (anchor && active.el.contains(anchor)
    ? (anchor.nodeType === 1 ? anchor : anchor.parentElement)
    : active.el)
  if (!BLOCK_TAGS.includes(block)) {
    // formatBlock only sees blocks INSIDE the editing host — but layout
    // headings are the host itself (a bare <h1>/<h2> being edited directly)
    const hit = sizeEl?.closest('h1, h2, h3, h4, blockquote')
    if (hit && (hit === active.el || active.el.contains(hit))) block = hit.tagName.toLowerCase()
  }
  const computed = win.getComputedStyle(sizeEl)
  const fontSize = Math.round(parseFloat(computed.fontSize)) || null
  return {
    fontSize,
    fontFamily: computed.fontFamily || '',
    bold: read('bold'),
    italic: read('italic'),
    underline: read('underline'),
    strike: read('strikeThrough'),
    ul: read('insertUnorderedList'),
    ol: read('insertOrderedList'),
    block: BLOCK_TAGS.includes(block) ? block : 'p',
    align: read('justifyCenter') ? 'center' : read('justifyRight') ? 'right' : read('justifyFull') ? 'justify' : 'left',
    link: Boolean(currentAnchor())
  }
}

function currentAnchor() {
  if (!active) return null
  const sel = active.bridge.win.getSelection()
  const node = sel?.anchorNode
  if (!node || !active.el.contains(node)) return null
  const el = node.nodeType === 1 ? node : node.parentElement
  return el?.closest('a') ?? null
}

/** Save the current text selection so it survives focusing a chrome input. */
export function saveTextSelection() {
  if (!active) return null
  const sel = active.bridge.win.getSelection()
  return sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
}

export function restoreTextSelection(range) {
  if (!active || !range) return
  const sel = active.bridge.win.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  active.el.focus()
}

/** Turn the given (saved) selection into a link; empty url removes links. */
export function applyLink(url, range) {
  if (!active) return
  restoreTextSelection(range)
  const href = String(url || '').trim()
  if (!href) {
    formatText('unlink')
    return
  }
  if (/^(?:javascript|data|vbscript):/i.test(href)) return
  formatText('createLink', /^(?:[a-z][a-z0-9+.-]*:|\/|#|\.)/i.test(href) ? href : `https://${href}`)
}

function cleanupMarkup(el) {
  // Browsers occasionally leave empty inline elements behind.
  for (const empty of el.querySelectorAll('b:empty, i:empty, u:empty, s:empty, strike:empty, a:empty, span:empty, strong:empty, em:empty')) {
    empty.remove()
  }
  for (const span of el.querySelectorAll('span:not([style]):not([class])')) {
    span.replaceWith(...span.childNodes)
  }
}

function maybeRemoveEmpty(el) {
  if (el.classList.contains('re-text') && !el.textContent.trim() && !el.querySelector('img, svg')) {
    el.remove()
    return true
  }
  return false
}
