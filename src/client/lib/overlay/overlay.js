// Moveable + click-selection, all operating INSIDE the iframe document so
// the scaled canvas coordinate space is handled natively (rootContainer).
import Moveable from 'moveable'
import Selecto from 'selecto'
import { ensurePositioned, roundGeometry } from '../model/position.js'
import { syncShapeGeometry } from '../model/shapes.js'
import { isEditingText, activeElement } from '../editors/text.js'
import { editor } from '../../stores/editor.svelte.js'
import { getCanvasSize } from './editmode.js'

/**
 * An "editable unit" is what a click selects: a .re-el, or any direct child
 * of the current section (foreign decks), but never the section itself.
 */
export function resolveEditable(target, section) {
  if (!section.contains(target) || target === section) return null
  if (target.closest('aside.notes, .re-transient')) return null
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
  let endpointResize = null

  function currentSection() {
    return bridge.currentSection
  }

  function buildMoveable() {
    moveable?.destroy()
    const section = currentSection()
    const guidelines = targets.length
      ? [section, ...[...section.children].filter((c) => !targets.includes(c))]
      : []
    const endpointShape = targets.length === 1 && ['line', 'arrow'].includes(targets[0].getAttribute('data-shape'))
    const startCorner = endpointShape ? targets[0].getAttribute('data-re-line-start') || 'nw' : null
    moveable = new Moveable(doc.body, {
      target: targets,
      rootContainer: doc.body,
      draggable: true,
      resizable: targets.length === 1 && !targets[0]?.classList.contains('re-group'),
      rotatable: targets.length === 1 && !endpointShape,
      renderDirections: endpointShape ? [startCorner, oppositeCorner(startCorner)] : ['n', 'nw', 'ne', 's', 'se', 'sw', 'e', 'w'],
      keepRatio: targets.length === 1 && targets[0]?.hasAttribute('data-re-lock-ratio'),
      origin: false,
      snappable: true,
      elementGuidelines: guidelines,
      elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      snapThreshold: 5,
      snapGridWidth: editor.settings.snapGrid ? Number(editor.settings.gridSize) || 20 : 0,
      snapGridHeight: editor.settings.snapGrid ? Number(editor.settings.gridSize) || 20 : 0,
      throttleRotate: 1,
      className: 're-moveable'
    })

    moveable
      .on('dragStart', (e) => {
        moveable.snappable = !snapOverride(e.inputEvent)
        onBeforeEdit?.()
        ensurePositioned(e.target, bridge)
      })
      .on('drag', (e) => {
        e.target.style.left = `${e.left}px`
        e.target.style.top = `${e.top}px`
      })
      .on('dragEnd', (e) => {
        moveable.snappable = true
        commit(e.target, e.isDrag)
      })
      .on('dragGroupStart', (e) => {
        moveable.snappable = !snapOverride(e.inputEvent)
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
        moveable.snappable = true
        e.targets.forEach((t) => commit(t, true))
      })
      .on('resizeStart', (e) => {
        moveable.snappable = !snapOverride(e.inputEvent)
        onBeforeEdit?.()
        ensurePositioned(e.target, bridge)
        if (endpointShape) endpointResize = beginEndpointResize(e.target, e.direction)
      })
      .on('resize', (e) => {
        if (endpointResize && e.inputEvent) {
          resizeEndpoint(e.target, e.inputEvent, endpointResize)
        } else {
          e.target.style.width = `${e.width}px`
          e.target.style.height = `${e.height}px`
          e.target.style.left = `${e.drag.left}px`
          e.target.style.top = `${e.drag.top}px`
        }
        syncShapeGeometry(e.target)
      })
      .on('resizeEnd', (e) => {
        moveable.snappable = true
        const wasEndpoint = Boolean(endpointResize)
        endpointResize = null
        commit(e.target, true)
        if (wasEndpoint) buildMoveable()
      })
      .on('rotateStart', (e) => {
        onBeforeEdit?.()
        ensurePositioned(e.target, bridge)
      })
      .on('rotate', (e) => {
        e.target.style.transform = e.transform
      })
      .on('rotateEnd', (e) => commit(e.target, true))
  }

  function snapOverride(inputEvent) {
    return Boolean(inputEvent?.ctrlKey)
  }

  function beginEndpointResize(el, direction) {
    const left = parseFloat(el.style.left) || 0
    const top = parseFloat(el.style.top) || 0
    const width = parseFloat(el.style.width) || el.clientWidth
    const height = parseFloat(el.style.height) || el.clientHeight
    const startCorner = el.getAttribute('data-re-line-start') || 'nw'
    const movingCorner = cornerFromDirection(direction)
    const endpoints = {
      [startCorner]: cornerPoint(startCorner, left, top, width, height),
      [oppositeCorner(startCorner)]: cornerPoint(oppositeCorner(startCorner), left, top, width, height)
    }
    return {
      movingStart: movingCorner === startCorner,
      fixed: endpoints[oppositeCorner(movingCorner)]
    }
  }

  function resizeEndpoint(el, inputEvent, state) {
    const section = currentSection()
    const rect = section.getBoundingClientRect()
    const canvas = getCanvasSize(bridge)
    const scale = rect.width / canvas.width || 1
    const moving = {
      x: (inputEvent.clientX - rect.left) / scale,
      y: (inputEvent.clientY - rect.top) / scale
    }
    const start = state.movingStart ? moving : state.fixed
    const end = state.movingStart ? state.fixed : moving
    const left = Math.min(start.x, end.x)
    const top = Math.min(start.y, end.y)
    const width = Math.max(1, Math.abs(end.x - start.x))
    const height = Math.max(1, Math.abs(end.y - start.y))
    const startCorner = `${start.y <= end.y ? 'n' : 's'}${start.x <= end.x ? 'w' : 'e'}`
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.width = `${width}px`
    el.style.height = `${height}px`
    el.setAttribute('data-re-line-start', startCorner)
  }

  function cornerFromDirection([x, y]) {
    return `${y < 0 ? 'n' : 's'}${x < 0 ? 'w' : 'e'}`
  }

  function oppositeCorner(corner) {
    return `${corner.includes('n') ? 's' : 'n'}${corner.includes('w') ? 'e' : 'w'}`
  }

  function cornerPoint(corner, left, top, width, height) {
    return {
      x: left + (corner.includes('e') ? width : 0),
      y: top + (corner.includes('s') ? height : 0)
    }
  }

  function commit(el, didChange) {
    if (!didChange) return
    roundGeometry(el)
    syncShapeGeometry(el)
    moveable?.updateRect()
    onEdit?.()
  }

  function setSelection(els) {
    targets = els.filter((el) => el && !el.hasAttribute('data-re-locked') && !el.hasAttribute('data-re-hidden'))
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
    if (!el || el.hasAttribute('data-re-locked')) {
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
    if (el && !el.hasAttribute('data-re-locked')) onDblClick?.(el, e)
  }

  function buildSelecto() {
    selecto = new Selecto({
      container: doc.body,
      rootContainer: doc.body,
      selectableTargets: ['.reveal .slides section.present > :not(aside.notes):not(.re-transient)'],
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
        e.inputEvent.target.closest?.('.moveable-control-box, .re-moveable, .controls, .slide-number') ||
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
    reconfigure: () => buildMoveable(),
    destroy() {
      doc.removeEventListener('click', onClick)
      doc.removeEventListener('dblclick', onDoubleClick)
      moveable?.destroy()
      selecto?.destroy()
    }
  }
}
