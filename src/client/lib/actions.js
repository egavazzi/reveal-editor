// UI actions — the single place where toolbar/keyboard intents meet the
// live deck DOM. Components call these; they coordinate stores, overlay
// selection, and model mutations.
import { editor, runtime } from '../stores/editor.svelte.js'
import {
  insertTextBox, insertShape, insertImageBlob, imageFromClipboard,
  insertMathBox, insertCodeBlock
} from './model/insert.js'
import { startTextEdit, formatText, isEditingText, activeElement } from './editors/text.js'
import {
  renderMath, getMathSource, commitMath, getCodeState, commitCode
} from './editors/mathcode.js'
import {
  addSlide, duplicateSlide, deleteSlide, moveSlide, setSlideBackground
} from './model/slides.js'
export { saveDeck } from './model/save.js'
export { slideSummaries } from './model/slides.js'

export function markDirty() {
  editor.dirty = true
  editor.docVersion++
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
  if (el.classList.contains('re-math') || el.querySelector('.katex')) {
    openMathEditor(el)
  } else if (tag === 'pre' || el.querySelector('pre > code')) {
    openCodeEditor(el)
  } else {
    beginTextEdit(el)
  }
}

// --- math ---

export function addMath() {
  const el = insertMathBox(runtime.bridge)
  renderMath(runtime.bridge, el)
  runtime.overlay.setSelection([el])
  markDirty()
  openMathEditor(el)
}

export function openMathEditor(el) {
  runtime.popoverEl = el
  runtime.popoverOriginal = el.innerHTML
  editor.popover = { type: 'math', value: getMathSource(el), lang: '' }
}

// --- code ---

export function addCode() {
  const el = insertCodeBlock(runtime.bridge)
  commitCode(runtime.bridge, el, el.querySelector('code').textContent, 'julia')
  runtime.overlay.setSelection([el])
  markDirty()
  openCodeEditor(el)
}

export function openCodeEditor(el) {
  const target = el.tagName.toLowerCase() === 'pre' ? el : el.querySelector('pre')
  const { source, lang } = getCodeState(target)
  runtime.popoverEl = target
  runtime.popoverOriginal = target.innerHTML
  editor.popover = { type: 'code', value: source, lang }
}

// --- popover lifecycle (shared by math and code) ---

let applyTimer = null

/** Live-apply popover changes to the slide element (debounced). */
export function updatePopover(value, lang) {
  if (!editor.popover) return
  editor.popover.value = value
  if (lang !== undefined) editor.popover.lang = lang
  clearTimeout(applyTimer)
  applyTimer = setTimeout(() => {
    const el = runtime.popoverEl
    if (!el || !editor.popover) return
    if (editor.popover.type === 'math') {
      commitMath(runtime.bridge, el, editor.popover.value)
    } else {
      commitCode(runtime.bridge, el, editor.popover.value, editor.popover.lang)
    }
    runtime.overlay.refresh()
    markDirty()
  }, 250)
}

export function closePopover(keep) {
  clearTimeout(applyTimer)
  const el = runtime.popoverEl
  if (!keep && el && runtime.popoverOriginal != null) {
    el.innerHTML = runtime.popoverOriginal
  } else if (keep && el && editor.popover) {
    // flush the last debounced edit synchronously
    if (editor.popover.type === 'math') {
      commitMath(runtime.bridge, el, editor.popover.value)
    } else {
      commitCode(runtime.bridge, el, editor.popover.value, editor.popover.lang)
    }
    markDirty()
  }
  runtime.overlay.refresh()
  editor.popover = null
  runtime.popoverEl = null
  runtime.popoverOriginal = null
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

// --- slides ---

export function slideAdd() {
  addSlide(runtime.bridge, editor.slideIndex.h)
  refreshSlideState()
}

export function slideDuplicate() {
  duplicateSlide(runtime.bridge, editor.slideIndex.h)
  refreshSlideState()
}

export function slideDelete() {
  if (deleteSlide(runtime.bridge, editor.slideIndex.h)) refreshSlideState()
}

export function slideMove(from, to) {
  moveSlide(runtime.bridge, from, to)
  refreshSlideState()
}

/** Apply a full slide permutation (order = old indices in new sequence). */
export function slideReorder(order) {
  const bridge = runtime.bridge
  const sections = bridge.getSections()
  if (order.length !== sections.length) return
  const current = sections[editor.slideIndex.h]
  for (const oldIndex of order) bridge.slidesEl.appendChild(sections[oldIndex])
  bridge.sync()
  bridge.goTo(bridge.getSections().indexOf(current))
  refreshSlideState()
}

export function slideGoTo(index) {
  runtime.bridge.goTo(index)
}

export function slideBackground(color) {
  setSlideBackground(runtime.bridge, editor.slideIndex.h, { color })
  markDirty()
}

function refreshSlideState() {
  runtime.overlay.setSelection([])
  editor.slideCount = runtime.bridge.getSections().length
  editor.slideIndex = runtime.bridge.getIndex()
  markDirty()
}

// --- fragments ---

export function toggleFragment() {
  for (const el of runtime.overlay.getSelection()) {
    if (el.classList.contains('fragment')) {
      el.classList.remove('fragment')
      el.removeAttribute('data-fragment-index')
      el.removeAttribute('data-re-frag-auto')
      if (!el.classList.length) el.removeAttribute('class')
    } else {
      el.classList.add('fragment')
      // explicit editor-made fragments keep whatever index the user sets;
      // without one, reveal orders them by document position
      el.setAttribute('data-re-frag-auto', '')
    }
  }
  runtime.bridge.sync()
  markDirty()
  bumpSelection()
}

export function setFragmentIndex(n) {
  for (const el of runtime.overlay.getSelection()) {
    if (!el.classList.contains('fragment')) continue
    if (Number.isFinite(n)) {
      el.setAttribute('data-fragment-index', String(n))
      el.removeAttribute('data-re-frag-auto')
    } else {
      el.removeAttribute('data-fragment-index')
      el.setAttribute('data-re-frag-auto', '')
    }
  }
  runtime.bridge.sync()
  markDirty()
}

// --- z-order ---

export function bringToFront() {
  for (const el of runtime.overlay.getSelection()) {
    const section = el.closest('section')
    section.appendChild(el)
  }
  runtime.overlay.refresh()
  markDirty()
}

export function sendToBack() {
  for (const el of runtime.overlay.getSelection()) {
    const section = el.closest('section')
    section.insertBefore(el, section.firstChild)
  }
  runtime.overlay.refresh()
  markDirty()
}

/** Selection metadata for the context bar (fragment state etc.). */
export function selectionInfo() {
  const sel = runtime.overlay?.getSelection() ?? []
  const first = sel[0]
  return {
    isFragment: !!first?.classList.contains('fragment'),
    fragmentIndex: first?.getAttribute('data-fragment-index') ?? ''
  }
}

function bumpSelection() {
  // re-announce selection so reactive panels update
  runtime.overlay.setSelection(runtime.overlay.getSelection())
}
