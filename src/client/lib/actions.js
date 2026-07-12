// UI actions — the single place where toolbar/keyboard intents meet the
// live deck DOM. Components call these; they coordinate stores, overlay
// selection, and model mutations.
import { editor, runtime } from '../stores/editor.svelte.js'
import {
  insertTextBox, insertShape, insertImageBlob, imageFromClipboard,
  insertMathBox, insertCodeBlock, insertVideoBlob, insertHtmlBlock
} from './model/insert.js'
import { startTextEdit, formatText, isEditingText, activeElement } from './editors/text.js'
import { ensurePositioned } from './model/position.js'
import { arrangeElements } from './model/alignment.js'
import { applyLayout, isSlideEmpty } from './model/layouts.js'
import {
  renderMath, getMathSource, commitMath, getCodeState, commitCode, isMathOnly
} from './editors/mathcode.js'
import {
  addSlide, addVerticalSlide, deleteCurrentSlide, duplicateCurrentSlide,
  demoteHorizontalSlide, moveCurrentSlide, promoteVerticalSlide, setSlideBackground
} from './model/slides.js'
import { snapshot, undo as histUndo, redo as histRedo } from './history/history.js'
import { cleanElementHtml } from './model/clean.js'
import { loadSlideTemplates, storeSlideTemplate } from './model/templates.js'
import { rehydrate } from './model/rehydrate.js'
import { saveDeck } from './model/save.js'
import {
  initializeSettings, updateSettings as updateSettingsModel, writeSettings
} from './model/settings.js'
export { saveDeck } from './model/save.js'
export { slideSummaries } from './model/slides.js'

export function snapshotSlide() {
  snapshot(runtime.bridge, { type: 'slide', h: editor.slideIndex.h, v: editor.slideIndex.v ?? 0 })
}

export function snapshotDeck() {
  snapshot(runtime.bridge, { type: 'deck', h: editor.slideIndex.h, v: editor.slideIndex.v ?? 0 })
}

export function undoAction() {
  const entry = histUndo(runtime.bridge)
  if (entry) afterHistory(entry)
}

export function redoAction() {
  const entry = histRedo(runtime.bridge)
  if (entry) afterHistory(entry)
}

function afterHistory(entry) {
  if (entry.scope.type === 'deck') initializeSettings(runtime.bridge, entry.settings)
  runtime.overlay.setSelection([])
  editor.slideCount = runtime.bridge.getSlideEntries?.().length ?? runtime.bridge.getSections().length
  editor.slideIndex = runtime.bridge.getIndex()
  markDirty()
}

let autosaveTimer = null

export function markDirty() {
  editor.dirty = true
  editor.docVersion++
  if (editor.autosave) {
    clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => saveDeck(), 1500)
  }
}

export function updateDeckSettings(patch) {
  snapshotDeck()
  updateSettingsModel(patch)
  markDirty()
}

export function addText() {
  snapshotSlide()
  const el = insertTextBox(runtime.bridge)
  markDirty()
  beginTextEdit(el, { selectAll: true })
}

export function addShape(kind) {
  snapshotSlide()
  const el = insertShape(runtime.bridge, kind)
  runtime.overlay.setSelection([el])
  markDirty()
}

export async function addImageBlob(blob, name) {
  try {
    const selection = runtime.overlay?.getSelection() ?? []
    const placeholder = selection.length === 1 && selection[0].classList.contains('re-image-placeholder')
      ? selection[0]
      : null
    snapshotSlide()
    const el = await insertImageBlob(runtime.bridge, blob, name)
    if (placeholder?.isConnected) {
      for (const prop of ['left', 'top', 'width', 'height']) {
        if (placeholder.style[prop]) el.style[prop] = placeholder.style[prop]
      }
      el.style.objectFit = 'contain'
      placeholder.remove()
    }
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

export async function addVideoBlob(blob, name) {
  try {
    snapshotSlide()
    const el = await insertVideoBlob(runtime.bridge, blob, name)
    runtime.overlay.setSelection([el])
    markDirty()
  } catch (err) {
    editor.statusMessage = `Video insert failed: ${err.message}`
  }
}

export function pickVideo() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'video/mp4,video/webm,video/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) addVideoBlob(file, file.name)
  }
  input.click()
}

export function handleFileDrop(event) {
  const file = [...(event.dataTransfer?.files ?? [])][0]
  if (!file || (!file.type.startsWith('image/') && !file.type.startsWith('video/'))) return false
  event.preventDefault()
  if (file.type.startsWith('video/')) addVideoBlob(file, file.name)
  else addImageBlob(file, file.name)
  return true
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
  snapshotSlide()
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
  if (tag === 'img' || tag === 'svg' || tag === 'video') return
  if (el.classList.contains('re-html')) {
    openHtmlEditor(el)
  } else if (el.classList.contains('re-math') || (el.querySelector('.katex') && isMathOnly(el))) {
    openMathEditor(el)
  } else if (tag === 'pre' || el.querySelector('pre > code')) {
    openCodeEditor(el)
  } else {
    beginTextEdit(el)
  }
}

// --- math ---

export function addMath() {
  snapshotSlide()
  const el = insertMathBox(runtime.bridge)
  renderMath(runtime.bridge, el)
  runtime.overlay.setSelection([el])
  markDirty()
  openMathEditor(el)
}

export function openMathEditor(el) {
  snapshotSlide()
  runtime.popoverEl = el
  runtime.popoverOriginal = el.innerHTML
  editor.popover = { type: 'math', value: getMathSource(el), lang: '' }
}

// --- code ---

export function addCode() {
  snapshotSlide()
  const el = insertCodeBlock(runtime.bridge)
  commitCode(runtime.bridge, el, el.querySelector('code').textContent, 'julia')
  runtime.overlay.setSelection([el])
  markDirty()
  openCodeEditor(el)
}

export function addHtml() {
  snapshotSlide()
  const el = insertHtmlBlock(runtime.bridge)
  runtime.overlay.setSelection([el])
  markDirty()
  openHtmlEditor(el)
}

export function openHtmlEditor(el) {
  snapshotSlide()
  runtime.popoverEl = el
  runtime.popoverOriginal = el.innerHTML
  editor.popover = { type: 'html', value: el.innerHTML, lang: '' }
}

export function openCodeEditor(el) {
  snapshotSlide()
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
    } else if (editor.popover.type === 'html') {
      el.innerHTML = editor.popover.value
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
    } else if (editor.popover.type === 'html') {
      el.innerHTML = editor.popover.value
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
  if (!(Number.isFinite(px) && px > 0)) return
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

export function slideAdd(layout = 'blank') {
  snapshotDeck()
  const section = addSlide(runtime.bridge, editor.slideIndex.h)
  applyLayout(section, layout, editor.settings)
  refreshSlideState()
}

export function slideApplyLayout(layout) {
  const section = runtime.bridge.currentSection
  if (!isSlideEmpty(section)) {
    editor.statusMessage = 'Layout presets can only be applied to an empty slide.'
    return false
  }
  snapshotSlide()
  const elements = applyLayout(section, layout, editor.settings)
  runtime.bridge.sync()
  runtime.overlay.setSelection(elements.filter((el) => !el.classList.contains('re-transient')))
  markDirty()
  return true
}

export function slideDuplicate() {
  snapshotDeck()
  duplicateCurrentSlide(runtime.bridge, editor.slideIndex.h, editor.slideIndex.v ?? 0)
  refreshSlideState()
}

export function slideDelete() {
  snapshotDeck()
  if (deleteCurrentSlide(runtime.bridge, editor.slideIndex.h, editor.slideIndex.v ?? 0)) refreshSlideState()
}

export function slideAddVertical(layout = 'blank') {
  snapshotDeck()
  const section = addVerticalSlide(runtime.bridge, editor.slideIndex.h, editor.slideIndex.v ?? 0)
  applyLayout(section, layout, editor.settings)
  refreshSlideState()
}

export function saveCurrentSlideTemplate(name) {
  const section = runtime.bridge?.currentSection
  const item = section && storeSlideTemplate({ name, html: cleanElementHtml(section) })
  editor.statusMessage = item ? `Saved slide template “${item.name}”.` : 'Enter a template name first.'
  return item
}

export function slideAddTemplate(id) {
  const item = loadSlideTemplates().find((template) => template.id === id)
  if (!item) return false
  snapshotDeck()
  const section = addSlide(runtime.bridge, editor.slideIndex.h)
  const holder = runtime.bridge.doc.createElement('div')
  holder.innerHTML = item.html
  const fresh = holder.firstElementChild
  if (!fresh || fresh.tagName !== 'SECTION') return false
  section.replaceWith(fresh)
  rehydrate(runtime.bridge, fresh)
  runtime.bridge.sync()
  runtime.bridge.goTo(editor.slideIndex.h + 1, 0)
  refreshSlideState()
  return true
}

export function slideMove(direction) {
  snapshotDeck()
  if (moveCurrentSlide(runtime.bridge, editor.slideIndex.h, editor.slideIndex.v ?? 0, direction)) {
    refreshSlideState()
    return true
  }
  return false
}

export function slidePromote() {
  snapshotDeck()
  if (promoteVerticalSlide(runtime.bridge, editor.slideIndex.h, editor.slideIndex.v ?? 0)) {
    refreshSlideState()
    return true
  }
  return false
}

export function slideDemote() {
  snapshotDeck()
  if ((editor.slideIndex.v ?? 0) !== 0) return false
  if (demoteHorizontalSlide(runtime.bridge, editor.slideIndex.h)) {
    refreshSlideState()
    return true
  }
  return false
}

/** Apply a full slide permutation (order = old indices in new sequence). */
export function slideReorder(order) {
  snapshotDeck()
  const bridge = runtime.bridge
  const sections = bridge.getSections()
  if (order.length !== sections.length) return
  const current = sections[editor.slideIndex.h]
  for (const oldIndex of order) bridge.slidesEl.appendChild(sections[oldIndex])
  bridge.sync()
  bridge.goTo(bridge.getSections().indexOf(current))
  refreshSlideState()
}

export function slideGoTo(h, v = 0) {
  runtime.bridge.goTo(h, v)
}

export function slideBackground(color) {
  snapshotSlide()
  setSlideBackground(runtime.bridge, editor.slideIndex.h, editor.slideIndex.v ?? 0, { color })
  markDirty()
}

export function currentSlideTransition() {
  return runtime.bridge?.currentSection?.getAttribute('data-transition') || ''
}

export function setCurrentSlideTransition(transition) {
  const section = runtime.bridge?.currentSection
  if (!section) return
  snapshotSlide()
  if (transition) section.setAttribute('data-transition', transition)
  else section.removeAttribute('data-transition')
  runtime.bridge.sync()
  markDirty()
}

export function currentSpeakerNotes() {
  const section = runtime.bridge?.currentSection
  return [...(section?.children || [])].find((el) => el.matches('aside.notes'))?.textContent || ''
}

export function setSpeakerNotes(notes) {
  const section = runtime.bridge?.currentSection
  if (!section) return
  snapshotSlide()
  let aside = [...section.children].find((el) => el.matches('aside.notes'))
  if (notes) {
    if (!aside) {
      aside = section.ownerDocument.createElement('aside')
      aside.className = 'notes'
      section.appendChild(aside)
    }
    aside.textContent = notes
  } else {
    aside?.remove()
  }
  runtime.bridge.sync()
  markDirty()
}

export function openPresentation({ pdf = false } = {}) {
  if (!editor.deckFile) return
  const file = encodeURIComponent(editor.deckFile)
  const suffix = pdf ? '?print-pdf' : ''
  window.open(`/deck/${file}${suffix}`, '_blank', 'noopener')
}

function refreshSlideState() {
  runtime.overlay.setSelection([])
  editor.slideCount = runtime.bridge.getSlideEntries?.().length ?? runtime.bridge.getSections().length
  editor.slideIndex = runtime.bridge.getIndex()
  markDirty()
}

// --- fragments ---

export function toggleFragment() {
  snapshotSlide()
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
  snapshotSlide()
  for (const el of runtime.overlay.getSelection()) {
    const section = el.closest('section')
    section.appendChild(el)
  }
  runtime.overlay.refresh()
  markDirty()
}

export function sendToBack() {
  snapshotSlide()
  for (const el of runtime.overlay.getSelection()) {
    const section = el.closest('section')
    section.insertBefore(el, section.firstChild)
  }
  runtime.overlay.refresh()
  markDirty()
}

export function currentLayers() {
  const section = runtime.bridge?.currentSection
  if (!section) return []
  const children = [...section.children].filter((el) => !el.matches('aside.notes, .re-transient'))
  return children.reverse().map((el, reverseIndex) => ({
    el,
    index: children.length - reverseIndex - 1,
    label: el.getAttribute('aria-label') || el.getAttribute('alt') ||
      el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 32) || `<${el.tagName.toLowerCase()}>`,
    tag: el.tagName.toLowerCase(),
    hidden: el.hasAttribute('data-re-hidden'),
    locked: el.hasAttribute('data-re-locked'),
    selected: runtime.overlay?.getSelection().includes(el) ?? false
  }))
}

export function selectLayer(el) {
  if (!el || el.hasAttribute('data-re-locked') || el.hasAttribute('data-re-hidden')) return
  runtime.overlay.setSelection([el])
}

export function toggleLayerHidden(el) {
  if (!el) return
  snapshotSlide()
  const hidden = !el.hasAttribute('data-re-hidden')
  el.toggleAttribute('data-re-hidden', hidden)
  el.style.visibility = hidden ? 'hidden' : ''
  if (hidden && runtime.overlay.getSelection().includes(el)) runtime.overlay.setSelection([])
  markDirty()
}

export function toggleLayerLocked(el) {
  if (!el) return
  snapshotSlide()
  const locked = !el.hasAttribute('data-re-locked')
  el.toggleAttribute('data-re-locked', locked)
  if (locked && runtime.overlay.getSelection().includes(el)) runtime.overlay.setSelection([])
  markDirty()
}

export function moveLayer(el, direction) {
  const section = el?.closest('section')
  if (!section) return
  snapshotSlide()
  if (direction === 'up' && el.nextElementSibling) el.nextElementSibling.after(el)
  if (direction === 'down' && el.previousElementSibling) el.previousElementSibling.before(el)
  runtime.overlay.refresh()
  markDirty()
}

export function setLayerName(el, name) {
  if (!el) return
  snapshotSlide()
  const value = String(name || '').trim()
  if (value) el.setAttribute('aria-label', value)
  else el.removeAttribute('aria-label')
  markDirty()
}

// --- alignment and distribution ---

export function arrangeSelection(mode) {
  const selection = runtime.overlay?.getSelection() ?? []
  if (selection.length < 2) return false
  snapshotSlide()
  for (const el of selection) ensurePositioned(el, runtime.bridge)
  if (!arrangeElements(selection, mode)) return false
  runtime.overlay.refresh()
  markDirty()
  bumpSelection()
  return true
}

export function selectedElementInfo() {
  const selection = runtime.overlay?.getSelection() ?? []
  if (selection.length !== 1) return null
  const el = selection[0]
  const rect = el.getBoundingClientRect()
  const rotation = el.style.transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1] || 0
  return {
    el,
    x: Math.round(parseFloat(el.style.left) || 0),
    y: Math.round(parseFloat(el.style.top) || 0),
    width: Math.round(parseFloat(el.style.width) || rect.width),
    height: Math.round(parseFloat(el.style.height) || rect.height),
    rotation: Number(rotation),
    lockRatio: el.hasAttribute('data-re-lock-ratio'),
    group: el.classList.contains('re-group')
  }
}

export function setElementProperties(values) {
  const info = selectedElementInfo()
  if (!info) return
  snapshotSlide()
  const { el } = info
  if (values.x != null) el.style.left = `${Number(values.x) || 0}px`
  if (values.y != null) el.style.top = `${Number(values.y) || 0}px`
  if (values.width != null) el.style.width = `${Math.max(1, Number(values.width) || 1)}px`
  if (values.height != null) el.style.height = `${Math.max(1, Number(values.height) || 1)}px`
  if (values.rotation != null) el.style.transform = `rotate(${Number(values.rotation) || 0}deg)`
  if (values.lockRatio != null) el.toggleAttribute('data-re-lock-ratio', Boolean(values.lockRatio))
  runtime.overlay.reconfigure()
  markDirty()
  bumpSelection()
}

export function groupSelection() {
  const selection = runtime.overlay?.getSelection() ?? []
  if (selection.length < 2 || selection.some((el) => el.parentElement !== selection[0].parentElement)) return false
  snapshotSlide()
  const doc = selection[0].ownerDocument
  const left = Math.min(...selection.map((el) => parseFloat(el.style.left) || 0))
  const top = Math.min(...selection.map((el) => parseFloat(el.style.top) || 0))
  const right = Math.max(...selection.map((el) => (parseFloat(el.style.left) || 0) + (parseFloat(el.style.width) || el.offsetWidth)))
  const bottom = Math.max(...selection.map((el) => (parseFloat(el.style.top) || 0) + (parseFloat(el.style.height) || el.offsetHeight)))
  const group = doc.createElement('div')
  group.className = 're-el re-group'
  Object.assign(group.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` })
  selection[0].before(group)
  for (const el of selection) {
    el.style.left = `${(parseFloat(el.style.left) || 0) - left}px`
    el.style.top = `${(parseFloat(el.style.top) || 0) - top}px`
    el.classList.remove('re-el')
    el.setAttribute('data-re-group-child', '')
    group.appendChild(el)
  }
  runtime.overlay.setSelection([group])
  markDirty()
  return true
}

export function ungroupSelection() {
  const selection = runtime.overlay?.getSelection() ?? []
  const group = selection.length === 1 && selection[0].classList.contains('re-group') ? selection[0] : null
  if (!group) return false
  snapshotSlide()
  const left = parseFloat(group.style.left) || 0
  const top = parseFloat(group.style.top) || 0
  const children = [...group.children]
  for (const child of children) {
    child.style.left = `${left + (parseFloat(child.style.left) || 0)}px`
    child.style.top = `${top + (parseFloat(child.style.top) || 0)}px`
    child.classList.add('re-el')
    child.removeAttribute('data-re-group-child')
    group.before(child)
  }
  group.remove()
  runtime.overlay.setSelection(children)
  markDirty()
  return true
}

// --- image properties ---

export function selectedImageInfo() {
  const sel = runtime.overlay?.getSelection() ?? []
  const el = sel.length === 1 && sel[0].tagName.toLowerCase() === 'img' ? sel[0] : null
  if (!el) return null
  const position = (el.style.objectPosition || '50% 50%').split(/\s+/)
  return {
    el,
    width: Math.round(parseFloat(el.style.width) || el.getBoundingClientRect().width),
    height: Math.round(parseFloat(el.style.height) || el.getBoundingClientRect().height),
    crop: el.style.objectFit === 'cover',
    cropX: Number.isFinite(parseFloat(position[0])) ? parseFloat(position[0]) : 50,
    cropY: Number.isFinite(parseFloat(position[1])) ? parseFloat(position[1]) : 50,
    borderWidth: parseFloat(el.style.borderWidth) || 0,
    borderColor: el.style.borderColor || '#000000',
    radius: parseFloat(el.style.borderRadius) || 0,
    shadow: el.style.boxShadow !== '' && el.style.boxShadow !== 'none',
    href: el.getAttribute('data-re-href') || ''
  }
}

export function setImageProperties(values) {
  const info = selectedImageInfo()
  if (!info) return
  let href = null
  if (values.href != null) {
    href = String(values.href).trim()
    if (/^(?:javascript|data|vbscript):/i.test(href)) href = ''
  }
  // A saved image link needs the deck-level click runtime. Capture the whole
  // deck so undo can also remove support nodes added by the first link.
  if (href) snapshotDeck()
  else snapshotSlide()
  const { el } = info
  if (values.width != null) el.style.width = `${Math.max(1, Number(values.width))}px`
  if (values.height != null) el.style.height = `${Math.max(1, Number(values.height))}px`
  if (values.crop != null) el.style.objectFit = values.crop ? 'cover' : 'contain'
  const x = values.cropX ?? info.cropX
  const y = values.cropY ?? info.cropY
  if (values.cropX != null || values.cropY != null) el.style.objectPosition = `${x}% ${y}%`
  if (values.borderWidth != null) el.style.borderWidth = `${Math.max(0, Number(values.borderWidth))}px`
  if (values.borderWidth != null) el.style.borderStyle = Number(values.borderWidth) ? 'solid' : ''
  if (values.borderColor != null) el.style.borderColor = values.borderColor
  if (values.radius != null) el.style.borderRadius = `${Math.max(0, Number(values.radius))}px`
  if (values.shadow != null) el.style.boxShadow = values.shadow ? '0 8px 24px rgba(0,0,0,.35)' : ''
  if (values.href != null) {
    if (href) el.setAttribute('data-re-href', href)
    else el.removeAttribute('data-re-href')
    if (href) writeSettings(runtime.bridge.slidesEl, editor.settings)
  }
  runtime.overlay.refresh()
  markDirty()
  bumpSelection()
}

// --- element clipboard / delete / nudge ---

let elementClipboard = []

export function deleteSelection() {
  const sel = runtime.overlay.getSelection()
  if (!sel.length) return
  snapshotSlide()
  for (const el of sel) el.remove()
  runtime.overlay.setSelection([])
  markDirty()
}

export function copySelection() {
  const sel = runtime.overlay.getSelection()
  if (sel.length) elementClipboard = sel.map(cleanElementHtml)
}

export function pasteElements() {
  if (!elementClipboard.length) return false
  snapshotSlide()
  const bridge = runtime.bridge
  const section = bridge.currentSection
  const pasted = []
  for (const html of elementClipboard) {
    const tmp = bridge.doc.createElement('div')
    tmp.innerHTML = html
    const el = tmp.firstElementChild
    if (!el) continue
    for (const prop of ['left', 'top']) {
      const v = parseFloat(el.style[prop])
      if (!Number.isNaN(v)) el.style[prop] = `${v + 24}px`
    }
    section.appendChild(el)
    rehydrate(bridge, el)
    pasted.push(el)
  }
  runtime.overlay.setSelection(pasted)
  markDirty()
  return true
}

export function duplicateSelection() {
  copySelection()
  pasteElements()
}

let lastNudge = 0

export function nudgeSelection(dx, dy) {
  const sel = runtime.overlay.getSelection()
  if (!sel.length) return false
  const now = Date.now()
  if (now - lastNudge > 800) snapshotSlide()
  lastNudge = now
  for (const el of sel) {
    ensurePositioned(el, runtime.bridge)
    el.style.left = `${Math.round(parseFloat(el.style.left) + dx)}px`
    el.style.top = `${Math.round(parseFloat(el.style.top) + dy)}px`
  }
  runtime.overlay.refresh()
  markDirty()
  return true
}

export function clearSelection() {
  runtime.overlay.setSelection([])
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
