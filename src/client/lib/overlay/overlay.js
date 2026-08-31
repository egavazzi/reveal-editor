// Moveable + click-selection, all operating INSIDE the iframe document so
// the scaled canvas coordinate space is handled natively (rootContainer).
import Moveable from 'moveable'
import Selecto from 'selecto'
import { ensurePositioned, roundGeometry } from '../model/position.js'
import { ANGLE_SNAP_STEP, FLAT_SNAP_TOLERANCE, constrainSegmentAngle, syncShapeGeometry } from '../model/shapes.js'
import { intrinsicSize, isImageFrame, mediaOf, readRect, resizeFrameContents } from '../model/crop.js'
import { VIDEO_CONTROLS_CLASS } from '../model/videocontrols.js'
import { createCropMode } from './crop.js'
import { isRatioLocked } from '../model/ratio.js'
import { isEditingText, activeElement } from '../editors/text.js'
import { editor } from '../../stores/editor.svelte.js'
import { getCanvasSize } from './editmode.js'

/**
 * An "editable unit" is what a click selects: a .re-el, or any direct child
 * of the current section (foreign decks), but never the section itself.
 */
export function resolveEditable(target, section) {
  if (!section.contains(target) || target === section) return null
  if (target.closest('aside.notes')) return null
  // transient editor hints are not content — except image placeholders,
  // which must be selectable so an image can be dropped into their frame
  const transient = target.closest('.re-transient')
  if (transient && !transient.classList.contains('re-image-placeholder')) return null
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
  // Resizing cropped media scales the picture with its frame; geometry
  // captured at gesture start.
  let frameResize = null
  // Mouse jitter between the clicks of a double-click must not count as a
  // drag (it would swallow the dblclick and nudge the element by a pixel).
  const DRAG_THRESHOLD = 4
  let dragMoved = false
  // A real drag/resize/rotate ends with a click event on the element; that
  // click must not be mistaken for an "edit this element" click.
  let lastRealDrag = 0

  function endGesture(realDrag) {
    if (realDrag) lastRealDrag = Date.now()
    return realDrag
  }

  const cropMode = createCropMode(bridge, {
    onDone(el, changed) {
      targets = [el]
      buildMoveable()
      onSelectionChange?.(targets)
      if (changed) onEdit?.()
    }
  })

  /** Enter PowerPoint-style crop mode on an image or video (bare or framed). */
  function beginCrop(el) {
    const media = mediaOf(el)
    if (!media || !el.isConnected || cropMode.active()) return
    // an unloaded/broken picture can't be cropped faithfully: converting a
    // legacy object-fit crop to frame geometry needs the intrinsic size
    if (!isImageFrame(el) && !(intrinsicSize(media).width > 0)) return
    onBeforeEdit?.()
    ensurePositioned(el, bridge)
    moveable?.destroy()
    moveable = null
    targets = [cropMode.start(el)]
    onSelectionChange?.(targets)
  }

  function currentSection() {
    return bridge.currentSection
  }

  /**
   * Videos are pointer-inert in edit mode, so pointer events land on the
   * section behind them. Resolve those by geometry instead of by target.
   */
  function resolveAtPointer(event, section) {
    const direct = resolveEditable(event.target, section)
    if (direct || event.clientX == null) return direct
    for (const video of section.querySelectorAll('video')) {
      // the crop preview's clone is a picture of the video, not the video
      if (video.closest('.re-transient')) continue
      // a cropped video shows only through its frame; the frame's box is
      // what the pointer can actually hit
      const r = (video.closest('.re-image-frame') ?? video).getBoundingClientRect()
      if (event.clientX >= r.left && event.clientX <= r.right &&
          event.clientY >= r.top && event.clientY <= r.bottom) {
        return resolveEditable(video, section)
      }
    }
    return null
  }

  function buildMoveable() {
    moveable?.destroy()
    // In crop mode the crop controller owns all handles; the regular
    // selection box would fight it.
    if (cropMode.active()) {
      moveable = null
      return
    }
    const section = currentSection()
    const guidelines = targets.length
      ? [section, ...[...section.children].filter(
          (c) => !targets.includes(c) && !c.classList.contains('re-transient'))]
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
      keepRatio: targets.length === 1 && isRatioLocked(targets[0]),
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
        // Ctrl over a video means "talk to the native player" — never a drag
        if (e.inputEvent?.ctrlKey && e.inputEvent.target?.closest?.('video')) return false
        moveable.snappable = !snapOverride(e.inputEvent)
        dragMoved = false
        onBeforeEdit?.()
        ensurePositioned(e.target, bridge)
      })
      .on('drag', (e) => {
        if (!dragMoved && Math.hypot(e.dist[0], e.dist[1]) < DRAG_THRESHOLD) return
        dragMoved = true
        e.target.style.left = `${e.left}px`
        e.target.style.top = `${e.top}px`
      })
      .on('dragEnd', (e) => {
        moveable.snappable = true
        commit(e.target, endGesture(e.isDrag && dragMoved))
      })
      .on('dragGroupStart', (e) => {
        moveable.snappable = !snapOverride(e.inputEvent)
        dragMoved = false
        onBeforeEdit?.()
        e.targets.forEach((t) => ensurePositioned(t, bridge))
      })
      .on('dragGroup', (e) => {
        if (!dragMoved && Math.hypot(e.dist[0], e.dist[1]) < DRAG_THRESHOLD) return
        dragMoved = true
        for (const ev of e.events) {
          ev.target.style.left = `${ev.left}px`
          ev.target.style.top = `${ev.top}px`
        }
      })
      .on('dragGroupEnd', (e) => {
        moveable.snappable = true
        const real = endGesture(dragMoved)
        e.targets.forEach((t) => commit(t, real))
      })
      .on('resizeStart', (e) => {
        moveable.snappable = !snapOverride(e.inputEvent)
        onBeforeEdit?.()
        ensurePositioned(e.target, bridge)
        if (endpointShape) endpointResize = beginEndpointResize(e.target, e.direction)
        frameResize = isImageFrame(e.target)
          ? { frame: readRect(e.target), media: readRect(mediaOf(e.target)) }
          : null
      })
      .on('resize', (e) => {
        if (endpointResize && e.inputEvent) {
          resizeEndpoint(e.target, e.inputEvent, endpointResize)
        } else {
          e.target.style.width = `${e.width}px`
          e.target.style.height = `${e.height}px`
          e.target.style.left = `${e.drag.left}px`
          e.target.style.top = `${e.drag.top}px`
          // cropped media's picture scales with its frame, keeping the crop
          if (frameResize) resizeFrameContents(e.target, frameResize, e.width, e.height)
        }
        syncShapeGeometry(e.target)
      })
      .on('resizeEnd', (e) => {
        moveable.snappable = true
        const wasEndpoint = Boolean(endpointResize)
        endpointResize = null
        if (frameResize) roundGeometry(mediaOf(e.target))
        frameResize = null
        commit(e.target, endGesture(true))
        if (wasEndpoint) buildMoveable()
      })
      .on('rotateStart', (e) => {
        onBeforeEdit?.()
        ensurePositioned(e.target, bridge)
      })
      .on('rotate', (e) => {
        e.target.style.transform = e.transform
      })
      .on('rotateEnd', (e) => commit(e.target, endGesture(true)))
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
    const pointer = {
      x: (inputEvent.clientX - rect.left) / scale,
      y: (inputEvent.clientY - rect.top) / scale
    }
    // Shift = strict 15deg steps; otherwise a near-flat drag lands flat
    // unless Ctrl (the snap override) is down.
    const moving = constrainSegmentAngle(state.fixed, pointer, {
      step: inputEvent.shiftKey ? ANGLE_SNAP_STEP : 0,
      tolerance: inputEvent.shiftKey || snapOverride(inputEvent) ? 0 : FLAT_SNAP_TOLERANCE
    })
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

  /**
   * `options` is passed on to the selection listener: the layers panel sets
   * `keepPanel` so picking a layer there doesn't swap the panel out from
   * under the click.
   */
  function setSelection(els, options = {}) {
    if (cropMode.active()) cropMode.commit()
    targets = els.filter((el) => el && !el.hasAttribute('data-re-locked') && !el.hasAttribute('data-re-hidden'))
    buildMoveable()
    onSelectionChange?.(targets, options)
  }

  function onClick(e) {
    if (cropMode.active()) return // the crop controller owns the pointer
    // Ignore clicks on moveable handles, and leave text editing alone
    if (e.target.closest?.('.moveable-control-box, .re-moveable')) return
    // The trailing click of a gesture is not a selection click. It usually
    // lands back on the element, but a snapped endpoint drag leaves the
    // pointer off it — that click must not clear the selection.
    if (Date.now() - lastRealDrag < 300) return
    if (isEditingText() && activeElement()?.contains(e.target)) return
    // Ctrl+click on a video or its control bar drives the player, not selection
    if (e.ctrlKey && e.target.closest?.(`video, .${VIDEO_CONTROLS_CLASS}`)) return
    const section = currentSection()
    if (!section) return
    const el = resolveAtPointer(e, section)
    if (!el || el.hasAttribute('data-re-locked')) {
      if (targets.length) setSelection([])
      return
    }
    if (e.shiftKey) {
      setSelection(targets.includes(el) ? targets.filter((t) => t !== el) : [...targets, el])
    } else if (!targets.includes(el)) {
      setSelection([el])
    } else if (targets.length === 1 && Date.now() - lastRealDrag > 300) {
      // Clicking the already-selected element enters its editor. This also
      // rescues double-clicks whose second press jittered a few px — the
      // browser never emits dblclick for those.
      onDblClick?.(el, e, { viaClick: true })
    }
  }

  function onDoubleClick(e) {
    if (cropMode.active()) return
    if (e.ctrlKey && e.target.closest?.(`video, .${VIDEO_CONTROLS_CLASS}`)) return
    const section = currentSection()
    if (!section) return
    let el = resolveAtPointer(e, section)
    // A selected element is covered by Moveable's invisible drag area, so
    // the dblclick lands on the overlay instead — route it to the target.
    if (!el && targets.length === 1 && e.target.closest?.('.moveable-control-box, .re-moveable')) {
      el = targets[0]
    }
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
        (section && resolveAtPointer(e.inputEvent, section))
      ) {
        e.stop()
      }
    })
    selecto.on('selectEnd', (e) => {
      if (e.selected.length) setSelection(e.selected)
    })
  }

  // Pointer-inert videos never receive the mousedown Moveable listens for,
  // so start its drag gesture manually when the press lands on a selected
  // video's footprint.
  function onMediaMousedown(e) {
    if (e.ctrlKey || e.button !== 0) return
    if (e.target.closest?.('.moveable-control-box, .re-moveable')) return
    const section = currentSection()
    if (!section || resolveEditable(e.target, section)) return
    const el = resolveAtPointer(e, section)
    if (el && el.tagName === 'VIDEO' && targets.length === 1 && targets[0] === el) {
      try { moveable.dragStart(e, el) } catch { /* gesture already active */ }
    }
  }

  doc.addEventListener('click', onClick)
  doc.addEventListener('dblclick', onDoubleClick)
  doc.addEventListener('mousedown', onMediaMousedown)
  buildMoveable()
  buildSelecto()

  bridge.Reveal.on('slidechanged', () => setSelection([]))

  return {
    setSelection,
    getSelection: () => targets,
    beginCrop,
    isCropping: () => cropMode.active(),
    refresh: () => moveable?.updateRect(),
    reconfigure: () => buildMoveable(),
    destroy() {
      if (cropMode.active()) cropMode.commit()
      doc.removeEventListener('click', onClick)
      doc.removeEventListener('dblclick', onDoubleClick)
      doc.removeEventListener('mousedown', onMediaMousedown)
      moveable?.destroy()
      selecto?.destroy()
    }
  }
}
