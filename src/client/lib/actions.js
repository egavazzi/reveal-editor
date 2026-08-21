// UI actions — the single place where toolbar/keyboard intents meet the
// live deck DOM. Components call these; they coordinate stores, overlay
// selection, and model mutations.
import { editor, runtime } from '../stores/editor.svelte.js'
import {
  insertTextBox, insertShape, insertImageBlob, imageFromClipboard,
  insertMathBox, insertCodeBlock, insertVideoBlob, insertHtmlBlock
} from './model/insert.js'
import { startTextEdit, formatText, setBlockStyle, isEditingText, activeElement } from './editors/text.js'
import { ensurePositioned } from './model/position.js'
import { arrangeElements } from './model/alignment.js'
import { applyLayout, isSlideEmpty } from './model/layouts.js'
import {
  renderMath, getMathSource, commitMath, getCodeState, commitCode, isMathOnly
} from './editors/mathcode.js'
import {
  addSlide, addVerticalSlide, deleteCurrentSlide, duplicateCurrentSlide,
  demoteHorizontalSlide, moveCurrentSlide, promoteVerticalSlide, setSlideBackground,
  toggleSlideHidden
} from './model/slides.js'
import { arrangeSlides } from './model/arrange.js'
import { rescaleSlides } from './model/rescale.js'
import { snapshot, undo as histUndo, redo as histRedo } from './history/history.js'
import { cleanElementHtml } from './model/clean.js'
import { loadSlideTemplates, storeSlideTemplate } from './model/templates.js'
import { rehydrate } from './model/rehydrate.js'
import { saveDeck } from './model/save.js'
import {
  initializeSettings, updateSettings as updateSettingsModel, writeSettings
} from './model/settings.js'
import { setShapeColors, shapeColors, syncShapeGeometry } from './model/shapes.js'
import { videoInfo, applyVideoProperties } from './model/media.js'
import { imageOf, isImageFrame, readRect, removeCrop, resizeFrameContents, rotationOf } from './model/crop.js'
import { isRatioLocked, setRatioLocked } from './model/ratio.js'
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
  // Selecting the UiT theme also adopts the template's native format —
  // 16:9 canvas (only when still on the scaffold default, rescaling the
  // content along) and no presentation margin, so full-bleed compositions
  // like the footer band reach the window edges. One undo step.
  if (patch.theme === 'uit' && editor.settings.theme !== 'uit') {
    snapshotDeck()
    const from = {
      width: Number(editor.settings.width) || 960,
      height: Number(editor.settings.height) || 700
    }
    const adoptSize = from.width === 960 && from.height === 700
    if (adoptSize) rescaleSlides(runtime.bridge.slidesEl, from, { width: 1280, height: 720 })
    updateSettingsModel({
      ...patch,
      ...(adoptSize ? { width: 1280, height: 720 } : {}),
      margin: 0,
      letterbox: true
    })
    runtime.bridge.sync()
    editor.statusMessage = adoptSize
      ? 'UiT theme: adopted the template format — 1280×720 canvas, no margin, PowerPoint-style letterboxing (all adjustable in Deck settings).'
      : 'UiT theme: presentation margin set to 0 and PowerPoint-style letterboxing enabled (adjustable in Deck settings).'
    markDirty()
    return
  }
  snapshotDeck()
  updateSettingsModel(patch)
  markDirty()
}

/**
 * Change the canvas size, optionally rescaling all positioned content so
 * slides keep their composition in the new format.
 */
export function resizeDeck(size, { scaleContent = true } = {}) {
  const from = {
    width: Number(editor.settings.width) || 960,
    height: Number(editor.settings.height) || 700
  }
  const to = {
    width: Math.max(100, Number(size.width) || from.width),
    height: Math.max(100, Number(size.height) || from.height)
  }
  if (to.width === from.width && to.height === from.height) return
  snapshotDeck()
  if (scaleContent) rescaleSlides(runtime.bridge.slidesEl, from, to)
  updateSettingsModel({ width: to.width, height: to.height })
  runtime.bridge.sync()
  markDirty()
}

export function addText() {
  snapshotSlide()
  const el = insertTextBox(runtime.bridge)
  markDirty()
  beginTextEdit(el, { selectAll: true })
}

/** Text copied in another application lands in a new text box. */
export function addTextBox(text) {
  snapshotSlide()
  const bridge = runtime.bridge
  const el = insertTextBox(bridge)
  el.textContent = ''
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) continue
    const p = bridge.doc.createElement('p')
    p.textContent = line.trim()
    el.appendChild(p)
  }
  runtime.overlay.setSelection([el])
  markDirty()
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
      el.style.objectFit = placeholder.getAttribute('data-re-fit') || 'contain'
      // take over the placeholder's stacking position too — frame images
      // must stay behind covering elements (e.g. the UiT field polygon)
      placeholder.before(el)
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
    el.addEventListener('error', () => {
      editor.statusMessage =
        'Video added, but this browser cannot decode it (unsupported codec) — it will not play here. Convert to WebM (VP9) or H.264 MP4.'
      editor.selectionVersion++
    }, { once: true })
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
    return
  }
  const data = event.clipboardData
  const own = clipboardElements(data?.getData('text/html'))
  if (own.length) {
    event.preventDefault()
    pasteElements(own)
    return
  }
  const text = data?.getData('text/plain') ?? ''
  if (text.trim()) {
    event.preventDefault()
    addTextBox(text)
    return
  }
  // An empty clipboard usually means the browser withheld a copy made in this
  // page; fall back to the elements that copy put aside.
  if (pasteElements()) event.preventDefault()
}

export function beginTextEdit(el, { selectAll = false, caretPoint = null } = {}) {
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
  } else if (caretPoint) {
    placeCaretAtPoint(el, caretPoint)
  }
}

/**
 * Put the caret where the user double-clicked. The dblclick often lands on
 * Moveable's overlay, so the browser never got to place a caret itself.
 */
function placeCaretAtPoint(el, { x, y }) {
  const doc = runtime.bridge.doc
  let range = null
  try {
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y)
      if (pos && el.contains(pos.offsetNode)) {
        range = doc.createRange()
        range.setStart(pos.offsetNode, pos.offset)
        range.collapse(true)
      }
    } else if (doc.caretRangeFromPoint) {
      const candidate = doc.caretRangeFromPoint(x, y)
      if (candidate && el.contains(candidate.startContainer)) range = candidate
    }
  } catch { /* leave the caret where focus put it */ }
  if (!range) return
  const sel = runtime.bridge.win.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * Route a double-click (or a click on an already-selected element) to the
 * right editor. viaClick only opens in-place text editing — popover editors
 * (math, code, HTML) stay double-click-only so a stray click can't open a
 * modal.
 */
export function editElement(el, event = null, { viaClick = false } = {}) {
  if (isEditingText() && activeElement() === el) return
  const tag = el.tagName.toLowerCase()
  if (tag === 'img' || isImageFrame(el)) {
    // double-clicking an image edits its crop (a plain click on the
    // selected image must not — too easy to hit while moving it)
    if (!viaClick) runtime.overlay.beginCrop(el)
    return
  }
  if (tag === 'svg' || tag === 'video') return
  if (el.classList.contains('re-html')) {
    if (!viaClick) openHtmlEditor(el)
  } else if (el.classList.contains('re-math') || (el.querySelector('.katex') && isMathOnly(el))) {
    if (!viaClick) openMathEditor(el)
  } else if (tag === 'pre' || el.querySelector('pre > code')) {
    if (!viaClick) openCodeEditor(el)
  } else if (!(viaClick && el.classList.contains('re-group'))) {
    beginTextEdit(el, event ? { caretPoint: { x: event.clientX, y: event.clientY } } : {})
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

export function applyBlockStyle(tag) {
  setBlockStyle(tag)
  markDirty()
}

/** Font size applies to whole boxes (like slides.com), not text runs. */
export function setFontSize(px) {
  if (!(Number.isFinite(px) && px > 0)) return
  const targets = isEditingText() ? [activeElement()] : runtime.overlay.getSelection()
  if (!isEditingText() && targets.length) snapshotSlide()
  for (const el of targets.filter(Boolean)) {
    el.style.fontSize = `${px}px`
  }
  runtime.overlay.refresh()
  markDirty()
}

/**
 * Vertical alignment of text inside its box, applied per box like font size.
 * Uses align-content, which works on block containers without switching the
 * box to flex (flex would stop sibling paragraph margins from collapsing).
 */
const VALIGN_STYLES = { top: '', middle: 'center', bottom: 'end' }

/** Force a synchronous layout of the element's document. */
function flushLayout(el) {
  return el.offsetHeight
}

export function setTextVAlign(align) {
  if (!(align in VALIGN_STYLES)) return
  const targets = (isEditingText() ? [activeElement()] : runtime.overlay.getSelection())
    .filter((el) => el && !el.matches('img, svg, [data-shape]'))
  if (!targets.length) return
  if (!isEditingText()) snapshotSlide()
  for (const el of targets) {
    // alignment only shows inside a fixed height; freeze the rendered height
    // for width-only boxes so the choice takes effect immediately
    if (align !== 'top' && !el.style.height && el.offsetHeight) {
      el.style.height = `${el.offsetHeight}px`
    }
    if (align === 'top') {
      // Gecko does not reflow when align-content simply goes away (the box
      // keeps its centered layout even though the computed value is back to
      // `normal`). Step through an explicit `start` and force a layout flush,
      // then drop the property so the saved style attribute stays clean.
      el.style.alignContent = 'start'
      flushLayout(el)
      el.style.removeProperty('align-content')
    } else {
      el.style.alignContent = VALIGN_STYLES[align]
    }
  }
  runtime.overlay.refresh()
  markDirty()
}

/** Vertical alignment of the first selected element ('top' when unset). */
export function currentTextVAlign() {
  const el = isEditingText() ? activeElement() : (runtime.overlay?.getSelection() ?? [])[0]
  const value = el?.style.alignContent
  return value === 'center' ? 'middle' : value === 'end' ? 'bottom' : 'top'
}

/** Effective font size (canvas px) of the first selected element. */
export function currentFontSize() {
  const el = isEditingText() ? activeElement() : (runtime.overlay?.getSelection() ?? [])[0]
  if (!el) return null
  const win = el.ownerDocument.defaultView
  return Math.round(parseFloat(win.getComputedStyle(el).fontSize)) || null
}

export function setTextColor(color) {
  if (isEditingText()) {
    formatText('foreColor', color)
  } else {
    const targets = runtime.overlay.getSelection()
    if (targets.length) snapshotSlide()
    for (const el of targets) {
      if (el.hasAttribute('data-shape')) setShapeColors(el, { stroke: color })
      else el.style.color = color
    }
  }
  markDirty()
}

// --- shape properties ---

export function selectedShapeInfo() {
  const sel = runtime.overlay?.getSelection() ?? []
  const el = sel.length === 1 && sel[0].hasAttribute('data-shape') ? sel[0] : null
  if (!el) return null
  ensurePositioned(el, runtime.bridge)
  const colors = shapeColors(el)
  const rotate = el.style.transform.match(/rotate\((-?[\d.]+)deg\)/)
  return {
    el,
    kind: el.getAttribute('data-shape'),
    x: Math.round(parseFloat(el.style.left) || 0),
    y: Math.round(parseFloat(el.style.top) || 0),
    width: Math.round(parseFloat(el.style.width) || el.getBoundingClientRect().width),
    height: Math.round(parseFloat(el.style.height) || el.getBoundingClientRect().height),
    rotation: rotate ? Number(rotate[1]) : 0,
    ...colors
  }
}

export function setShapeProperties(values) {
  const info = selectedShapeInfo()
  if (!info) return
  snapshotSlide()
  const { el } = info
  if (values.x != null) el.style.left = `${Number(values.x) || 0}px`
  if (values.y != null) el.style.top = `${Number(values.y) || 0}px`
  if (values.width != null) el.style.width = `${Math.max(1, Number(values.width))}px`
  if (values.height != null) el.style.height = `${Math.max(1, Number(values.height))}px`
  if (values.rotation != null) {
    const rotation = Number(values.rotation) || 0
    el.style.transform = rotation ? `rotate(${rotation}deg)` : ''
  }
  setShapeColors(el, values)
  syncShapeGeometry(el)
  runtime.overlay.refresh()
  markDirty()
  bumpSelection()
}

// --- slides ---

export function slideAdd(layout = 'blank') {
  snapshotDeck()
  const section = addSlide(runtime.bridge, editor.slideIndex.h)
  applyLayout(section, layout, editor.settings)
  // re-sync: the layout may have set slide attributes (background color)
  // that reveal mirrors into its background layer
  runtime.bridge.sync()
  refreshSlideState()
}

export function slideApplyLayout(layout) {
  const section = runtime.bridge.currentSection
  const hasContent = !isSlideEmpty(section)
  if (hasContent && !window.confirm(
    'Applying a layout replaces the contents of this slide (speaker notes are kept). Continue? Undo (Ctrl+Z) restores it.'
  )) {
    return false
  }
  snapshotSlide()
  if (hasContent) {
    for (const el of [...section.children]) {
      if (!el.matches('aside.notes')) el.remove()
    }
  }
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
  // re-sync: the layout may have set slide attributes (background color)
  // that reveal mirrors into its background layer
  runtime.bridge.sync()
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

/** Apply a full slide matrix from the arrange view (columns of leaf sections). */
export function slideArrange(matrix) {
  const bridge = runtime.bridge
  const current = bridge.getSlide(editor.slideIndex.h, editor.slideIndex.v ?? 0)
  snapshotDeck()
  if (!arrangeSlides(bridge, matrix)) return false
  const entry = bridge.getSlideEntries().find((e) => e.section === current)
  bridge.goTo(entry?.h ?? 0, entry?.v ?? 0)
  refreshSlideState()
  return true
}

/**
 * Toggle whether a slide is skipped when presenting (reveal's
 * data-visibility="hidden"). Defaults to the current slide.
 */
export function slideToggleHidden(h = editor.slideIndex.h, v = editor.slideIndex.v ?? 0) {
  snapshotDeck()
  const hidden = toggleSlideHidden(runtime.bridge, h, v)
  if (hidden === null) return false
  // Hidden slides survive an editor reload only because the settings runtime
  // script forces showHiddenSlides before reveal initializes — make sure the
  // deck carries that script even if settings were never touched.
  writeSettings(runtime.bridge.slidesEl, editor.settings)
  editor.statusMessage = hidden
    ? 'Slide hidden — it will be skipped when presenting. Click the eye icon to show it again.'
    : 'Slide will be shown when presenting.'
  markDirty()
  return true
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

/**
 * Open the standalone deck in a new tab. `fromCurrent` starts the show on the
 * slide being edited, via reveal's own #/h/v location hash — the presentation
 * view runs with hash navigation on, so it reads that on load. Like Present
 * from the start, this opens the file ON DISK: unsaved edits are not in it.
 */
export function openPresentation({ pdf = false, fromCurrent = false } = {}) {
  if (!editor.deckFile) return
  const file = encodeURIComponent(editor.deckFile)
  let suffix = pdf ? '?print-pdf' : ''
  if (!pdf && fromCurrent) {
    const { h, v } = editor.slideIndex
    suffix = `#/${h}${v ? `/${v}` : ''}`
  }
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
  const targets = runtime.overlay.getSelection().filter((el) => el.classList.contains('fragment'))
  if (!targets.length) return
  snapshotSlide()
  for (const el of targets) {
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
  bumpSelection()
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

const LAYER_KIND_LABELS = {
  image: 'Image', video: 'Video', shape: 'Shape', math: 'Math',
  code: 'Code', html: 'HTML', group: 'Group', text: 'Text'
}

/** Classify a slide element for the layers panel. */
export function layerKind(el) {
  const tag = el.tagName.toLowerCase()
  if (tag === 'img' || isImageFrame(el)) return 'image'
  if (tag === 'video') return 'video'
  if (tag === 'svg') return 'shape'
  if (el.classList.contains('re-math') || el.querySelector?.(':scope .katex')) return 'math'
  if (el.classList.contains('re-html')) return 'html'
  if (el.classList.contains('re-group')) return 'group'
  if (tag === 'pre' || el.querySelector?.('pre > code')) return 'code'
  return 'text'
}

export function currentLayers() {
  const section = runtime.bridge?.currentSection
  if (!section) return []
  const children = [...section.children].filter((el) => !el.matches('aside.notes, .re-transient'))
  return children.reverse().map((el, reverseIndex) => {
    const kind = layerKind(el)
    const name = el.getAttribute('aria-label') || el.getAttribute('alt') ||
      (kind === 'image' ? imageOf(el)?.getAttribute('alt') : '') || ''
    const text = kind === 'text' || kind === 'math' || kind === 'code'
      ? el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40) || ''
      : ''
    return {
      el,
      index: children.length - reverseIndex - 1,
      kind,
      name,
      preview: text,
      label: name || text || LAYER_KIND_LABELS[kind],
      // tiny visual for the row icon
      src: kind === 'image' ? el.getAttribute('src') : null,
      svg: kind === 'shape' ? el.outerHTML : null,
      shapeKind: el.getAttribute?.('data-shape') || null,
      tag: el.tagName.toLowerCase(),
      hidden: el.hasAttribute('data-re-hidden'),
      locked: el.hasAttribute('data-re-locked'),
      selected: runtime.overlay?.getSelection().includes(el) ?? false
    }
  })
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
  return {
    el,
    x: Math.round(parseFloat(el.style.left) || 0),
    y: Math.round(parseFloat(el.style.top) || 0),
    width: Math.round(parseFloat(el.style.width) || rect.width),
    height: Math.round(parseFloat(el.style.height) || rect.height),
    rotation: rotationOf(el),
    lockRatio: isRatioLocked(el),
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
  // resizing a cropped image scales the picture with its frame
  const frameStart = isImageFrame(el) && (values.width != null || values.height != null)
    ? { frame: readRect(el), img: readRect(imageOf(el)) }
    : null
  if (values.width != null) el.style.width = `${Math.max(1, Number(values.width) || 1)}px`
  if (values.height != null) el.style.height = `${Math.max(1, Number(values.height) || 1)}px`
  if (frameStart) resizeFrameContents(el, frameStart, parseFloat(el.style.width), parseFloat(el.style.height))
  if (values.rotation != null) el.style.transform = `rotate(${Number(values.rotation) || 0}deg)`
  if (values.lockRatio != null) setRatioLocked(el, values.lockRatio)
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

// --- video properties ---

export function selectedVideoInfo() {
  const sel = runtime.overlay?.getSelection() ?? []
  return sel.length === 1 ? videoInfo(sel[0]) : null
}

export function setVideoProperties(values) {
  const info = selectedVideoInfo()
  if (!info) return
  snapshotSlide()
  applyVideoProperties(info.el, values)
  runtime.overlay.refresh()
  markDirty()
  bumpSelection()
}

// --- image properties ---

export function selectedImageInfo() {
  const sel = runtime.overlay?.getSelection() ?? []
  const el = sel.length === 1 ? sel[0] : null
  const img = el ? imageOf(el) : null
  if (!img) return null
  return {
    el,
    cropped: isImageFrame(el),
    width: Math.round(parseFloat(el.style.width) || el.getBoundingClientRect().width),
    height: Math.round(parseFloat(el.style.height) || el.getBoundingClientRect().height),
    borderWidth: parseFloat(el.style.borderWidth) || 0,
    borderColor: el.style.borderColor || '#000000',
    radius: parseFloat(el.style.borderRadius) || 0,
    shadow: el.style.boxShadow !== '' && el.style.boxShadow !== 'none',
    href: img.getAttribute('data-re-href') || ''
  }
}

/** Enter PowerPoint-style crop mode on the selected image. */
export function cropSelectedImage() {
  const sel = runtime.overlay?.getSelection() ?? []
  if (sel.length === 1 && imageOf(sel[0])) runtime.overlay.beginCrop(sel[0])
}

/** Restore the full picture of a cropped image at its current size. */
export function removeImageCrop() {
  const info = selectedImageInfo()
  if (!info?.cropped) return
  snapshotSlide()
  const img = removeCrop(info.el)
  runtime.overlay.setSelection([img])
  markDirty()
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
  const img = imageOf(el)
  if (values.width != null || values.height != null) {
    // write only the edited dimension: a foreign-deck image may have no
    // inline height (or width), and that auto dimension must stay auto
    const start = { frame: readRect(el), img: readRect(img) }
    if (values.width != null) el.style.width = `${Math.max(1, Number(values.width))}px`
    if (values.height != null) el.style.height = `${Math.max(1, Number(values.height))}px`
    // a frame always carries both inline dimensions (wrapImage sets them)
    if (info.cropped) resizeFrameContents(el, start, parseFloat(el.style.width), parseFloat(el.style.height))
  }
  if (values.borderWidth != null) el.style.borderWidth = `${Math.max(0, Number(values.borderWidth))}px`
  if (values.borderWidth != null) el.style.borderStyle = Number(values.borderWidth) ? 'solid' : ''
  if (values.borderColor != null) el.style.borderColor = values.borderColor
  if (values.radius != null) el.style.borderRadius = `${Math.max(0, Number(values.radius))}px`
  if (values.shadow != null) el.style.boxShadow = values.shadow ? '0 8px 24px rgba(0,0,0,.35)' : ''
  if (values.href != null) {
    if (href) img.setAttribute('data-re-href', href)
    else img.removeAttribute('data-re-href')
    if (href) writeSettings(runtime.bridge.slidesEl, editor.settings)
  }
  runtime.overlay.refresh()
  markDirty()
  bumpSelection()
}

// --- element clipboard / delete / nudge ---

// Copied elements go on the SYSTEM clipboard, tagged with this attribute so a
// paste can recognize them again. A private in-editor clipboard would outrank
// whatever the user copied most recently somewhere else, and there is no way
// to tell which of the two is newer — copying a text box here would then
// shadow every image or text copied in another app for the rest of the
// session. The in-memory copy is only a fallback for browsers that hand us an
// empty clipboard for a copy made in this page.
const CLIPBOARD_MARKER = 'data-re-clipboard'
let elementClipboard = []

export function deleteSelection() {
  const sel = runtime.overlay.getSelection()
  if (!sel.length) return
  snapshotSlide()
  for (const el of sel) el.remove()
  runtime.overlay.setSelection([])
  markDirty()
}

/** Copy handler for a real copy/cut event; also usable without one. */
export function handleCopy(event) {
  if (isEditingText()) return // copying text inside a box is the browser's job
  copySelection(event)
}

export function copySelection(event = null) {
  const sel = runtime.overlay.getSelection()
  if (!sel.length) return false
  elementClipboard = sel.map(cleanElementHtml)
  const data = event?.clipboardData
  if (data) {
    data.setData('text/html', `<div ${CLIPBOARD_MARKER}>${elementClipboard.join('')}</div>`)
    // so the elements paste as something sensible in other applications too
    const text = sel.map((el) => el.textContent.trim()).filter(Boolean).join('\n')
    if (text) data.setData('text/plain', text)
    event.preventDefault()
  }
  return true
}

/** The elements of a copy made in this editor, or [] for foreign clipboards. */
export function clipboardElements(html) {
  if (!html || !html.includes(CLIPBOARD_MARKER)) return []
  const holder = new DOMParser().parseFromString(html, 'text/html')
    .querySelector(`[${CLIPBOARD_MARKER}]`)
  return holder ? [...holder.children].map((el) => el.outerHTML) : []
}

export function pasteElements(htmlList = elementClipboard) {
  if (!htmlList.length) return false
  snapshotSlide()
  const bridge = runtime.bridge
  const section = bridge.currentSection
  const pasted = []
  for (const html of htmlList) {
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
  // deliberately not via the clipboard: duplicating must not throw away what
  // the user has copied
  const sel = runtime.overlay.getSelection()
  if (sel.length) pasteElements(sel.map(cleanElementHtml))
}

let lastNudge = 0

export function nudgeSelection(dx, dy) {
  // the crop controller owns the geometry while cropping; a nudge would
  // move the element under its handles without updating them
  if (runtime.overlay.isCropping?.()) return false
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
