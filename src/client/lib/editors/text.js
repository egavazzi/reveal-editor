// In-place rich text editing via contenteditable on the actual slide
// element — no wrapper, no editor scaffolding in the DOM, so the save
// round-trip stays clean by construction. Formatting commands use
// execCommand with styleWithCSS off, which produces plain semantic tags
// (<b>, <i>, <ul>…) that are exactly what belongs in the file.

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
  el.setAttribute('contenteditable', 'true')
  el.setAttribute('spellcheck', 'false')
  el.focus()

  const finish = () => stopTextEdit()
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
    if (!el.contains(e.target)) stopTextEdit()
  }
  el.addEventListener('blur', finish)
  el.addEventListener('keydown', onKeydown)
  doc.addEventListener('mousedown', onDocMousedown, true)

  active = { el, bridge, onDone, finish, onKeydown, onDocMousedown, doc }
  return active
}

export function stopTextEdit() {
  if (!active) return
  const { el, onDone, finish, onKeydown, onDocMousedown, doc } = active
  active = null
  el.removeEventListener('blur', finish)
  el.removeEventListener('keydown', onKeydown)
  doc.removeEventListener('mousedown', onDocMousedown, true)
  el.removeAttribute('contenteditable')
  el.removeAttribute('spellcheck')
  cleanupMarkup(el)
  const removed = maybeRemoveEmpty(el)
  onDone?.({ el, removed })
}

/** Apply a formatting command to the current text selection. */
export function formatText(command, value = null) {
  if (!active) return
  const doc = active.bridge.doc
  doc.execCommand('styleWithCSS', false, ['foreColor', 'fontSize'].includes(command))
  doc.execCommand(command, false, value)
  active.el.focus()
}

function cleanupMarkup(el) {
  // Browsers occasionally leave empty inline elements behind.
  for (const empty of el.querySelectorAll('b:empty, i:empty, u:empty, span:empty, strong:empty, em:empty')) {
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
