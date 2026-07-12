// Moveable + click-selection, all operating INSIDE the iframe document so
// the scaled canvas coordinate space is handled natively (rootContainer).
import Moveable from 'moveable'
import Selecto from 'selecto'
import { ensurePositioned, roundGeometry } from '../model/position.js'
import { syncShapeGeometry } from '../model/shapes.js'
import { isEditingText, activeElement } from '../editors/text.js'

/**
 * An "editable unit" is what a click selects: a .re-el, or any direct child
 * of the current section (foreign decks), but never the section itself.
 */
export function resolveEditable(target, section) {
  if (!section.contains(target) || target === section) return null
  const reEl = target.closest('.re-el')
  if (reEl && section.contains(reEl)) return reEl
  let el = target
  while (el.parentElement && el.parentElement !== section) el = el.parentElement
  return el.parentElement === section ? el : null
}

export function createOverlay(bridge, { onSelectionChange, onEdit, onDblClick, onBeforeEdit }) {
  const doc = bridge.doc
  let targets = []
  let moveable = null
  let selecto = null

  function currentSection() {
    return bridge.currentSection
  }

  function buildMoveable() {
    moveable?.destroy()
    const section = currentSection()
    const guidelines = targets.length
      ? [section, ...[...section.children].filter((c) => !targets.includes(c))]
      : []
    moveable = new Moveable(doc.body, {
      target: targets,
      rootContainer: doc.body,
      draggable: true,
      resizable: targets.length === 1,
      rotatable: targets.length === 1,
      keepRatio: false,
      origin: false,
      snappable: true,
      elementGuidelines: guidelines,
      elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      snapThreshold: 5,
      throttleRotate: 1,
      className: 're-moveable'
    })

    moveable
      .on('dragStart', (e) => {
        onBeforeEdit?.()
        ensurePositioned(e.target, bridge)
      })
      .on('drag', (e) => {
        e.target.style.left = `${e.left}px`
        e.target.style.top = `${e.top}px`
      })
      .on('dragEnd', (e) => commit(e.target, e.isDrag))
      .on('dragGroupStart', (e) => {
        onBeforeEdit?.()
        e.targets.forEach((t) => ensurePositioned(t, bridge))
      })
      .on('dragGroup', (e) => {
        for (const ev of e.events) {
          ev.target.style.left = `${ev.left}px`
          ev.target.style.top = `${ev.top}px`
        }
      })
      .on('dragGroupEnd', (e) => {
        e.targets.forEach((t) => commit(t, true))
      })
      .on('resizeStart', (e) => {
        onBeforeEdit?.()
        ensurePositioned(e.target, bridge)
      })
      .on('resize', (e) => {
        e.target.style.width = `${e.width}px`
        e.target.style.height = `${e.height}px`
        e.target.style.left = `${e.drag.left}px`
        e.target.style.top = `${e.drag.top}px`
        syncShapeGeometry(e.target)
      })
      .on('resizeEnd', (e) => commit(e.target, true))
      .on('rotateStart', (e) => {
        onBeforeEdit?.()
        ensurePositioned(e.target, bridge)
      })
      .on('rotate', (e) => {
        e.target.style.transform = e.transform
      })
      .on('rotateEnd', (e) => commit(e.target, true))
  }

  function commit(el, didChange) {
    if (!didChange) return
    roundGeometry(el)
    syncShapeGeometry(el)
    moveable?.updateRect()
    onEdit?.()
  }

  function setSelection(els) {
    targets = els.filter(Boolean)
    buildMoveable()
    onSelectionChange?.(targets)
  }

  function onClick(e) {
    // Ignore clicks on moveable handles, and leave text editing alone
    if (e.target.closest?.('.moveable-control-box, .re-moveable')) return
    if (isEditingText() && activeElement()?.contains(e.target)) return
    const section = currentSection()
    if (!section) return
    const el = resolveEditable(e.target, section)
    if (!el) {
      if (targets.length) setSelection([])
      return
    }
    if (e.shiftKey) {
      setSelection(targets.includes(el) ? targets.filter((t) => t !== el) : [...targets, el])
    } else if (!targets.includes(el)) {
      setSelection([el])
    }
  }

  function onDoubleClick(e) {
    const section = currentSection()
    if (!section) return
    const el = resolveEditable(e.target, section)
    if (el) onDblClick?.(el, e)
  }

  function buildSelecto() {
    selecto = new Selecto({
      container: doc.body,
      rootContainer: doc.body,
      selectableTargets: ['.reveal .slides section.present > *'],
      hitRate: 0,
      selectByClick: false,
      selectFromInside: false,
      toggleContinueSelect: 'shift',
      ratio: 0
    })
    selecto.on('dragStart', (e) => {
      // don't start rubber band from an element or the moveable box
      const section = currentSection()
      if (
        e.inputEvent.target.closest?.('.moveable-control-box, .re-moveable') ||
        (section && resolveEditable(e.inputEvent.target, section))
      ) {
        e.stop()
      }
    })
    selecto.on('selectEnd', (e) => {
      if (e.selected.length) setSelection(e.selected)
    })
  }

  doc.addEventListener('click', onClick)
  doc.addEventListener('dblclick', onDoubleClick)
  buildMoveable()
  buildSelecto()

  bridge.Reveal.on('slidechanged', () => setSelection([]))

  return {
    setSelection,
    getSelection: () => targets,
    refresh: () => moveable?.updateRect(),
    destroy() {
      doc.removeEventListener('click', onClick)
      doc.removeEventListener('dblclick', onDoubleClick)
      moveable?.destroy()
      selecto?.destroy()
    }
  }
}
