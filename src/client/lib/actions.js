// UI actions — the single place where toolbar/keyboard intents meet the
// live deck DOM. Components call these; they coordinate stores, overlay
// selection, and model mutations.
import { editor, runtime } from '../stores/editor.svelte.js'
import { insertTextBox, insertShape, insertImageBlob, imageFromClipboard } from './model/insert.js'
import { startTextEdit, formatText, isEditingText, activeElement } from './editors/text.js'
export { saveDeck } from './model/save.js'

export function markDirty() {
  editor.dirty = true
}

export function addText() {
  const el = insertTextBox(runtime.bridge)
  markDirty()
  beginTextEdit(el, { selectAll: true })
}

export function addShape(kind) {
  const el = insertShape(runtime.bridge, kind)
  runtime.overlay.setSelection([el])
  markDirty()
}

export async function addImageBlob(blob, name) {
  try {
    const el = await insertImageBlob(runtime.bridge, blob, name)
    runtime.overlay.setSelection([el])
    markDirty()
  } catch (err) {
    editor.statusMessage = `Image insert failed: ${err.message}`
  }
}

/** Open a file picker (in the parent document) and insert the chosen image. */
export function pickImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) addImageBlob(file, file.name)
  }
  input.click()
}

export function handlePaste(event) {
  if (isEditingText()) return // let the browser paste text normally
  const blob = imageFromClipboard(event)
  if (blob) {
    event.preventDefault()
    addImageBlob(blob, 'pasted.png')
  }
}

export function beginTextEdit(el, { selectAll = false } = {}) {
  runtime.overlay.setSelection([])
  editor.textEditing = true
  startTextEdit(el, runtime.bridge, {
    onDone({ el: doneEl, removed }) {
      editor.textEditing = false
      if (!removed) runtime.overlay.setSelection([doneEl])
      markDirty()
    }
  })
  if (selectAll) {
    const doc = runtime.bridge.doc
    const range = doc.createRange()
    range.selectNodeContents(el)
    const sel = runtime.bridge.win.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

/** Route a double-click on a slide element to the right editor. */
export function editElement(el) {
  const tag = el.tagName.toLowerCase()
  if (tag === 'img' || tag === 'svg') return
  if (el.querySelector('.katex') || tag === 'pre') return // handled in M5 editors
  beginTextEdit(el)
}

export function applyFormat(command, value) {
  formatText(command, value)
  markDirty()
}

/** Font size applies to whole boxes (like slides.com), not text runs. */
export function setFontSize(px) {
  const targets = isEditingText() ? [activeElement()] : runtime.overlay.getSelection()
  for (const el of targets.filter(Boolean)) {
    el.style.fontSize = `${px}px`
  }
  runtime.overlay.refresh()
  markDirty()
}

export function setTextColor(color) {
  if (isEditingText()) {
    formatText('foreColor', color)
  } else {
    for (const el of runtime.overlay.getSelection()) {
      el.style.color = color
    }
  }
  markDirty()
}
