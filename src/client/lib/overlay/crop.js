// PowerPoint-style crop mode. While active, the full picture shows dimmed
// behind the frame with the framed part at full opacity. Dragging the
// frame's edge handles crops (the picture stays put on the canvas),
// dragging the picture pans it inside the frame, and the picture's corner
// handles zoom it. Enter/Escape or clicking elsewhere commits.
import Moveable from 'moveable'
import {
  imageOf, isImageFrame, wrapImage, unwrapImage, isTrivialCrop, readRect, writeRect
} from '../model/crop.js'
import { roundGeometry } from '../model/position.js'

const CROP_STYLE_ID = 're-crop-style'

export function createCropMode(bridge, { onDone }) {
  const doc = bridge.doc
  let frame = null
  let frameBox = null
  let pictureBox = null
  let view = null
  let viewImg = null
  let mutated = false
  // attributes to restore if the session ends without any actual cropping,
  // so an accidental enter+leave round-trips the markup exactly
  let pristine = null

  function active() {
    return Boolean(frame)
  }

  function start(el) {
    if (active()) commit()
    injectStyles(doc)
    pristine = isImageFrame(el)
      ? null
      : { style: el.getAttribute('style'), class: el.getAttribute('class') }
    frame = wrapImage(el)
    mutated = false
    const img = imageOf(frame)
    frame.classList.add('re-cropping')
    buildView(img)

    frameBox = new Moveable(doc.body, {
      target: frame,
      rootContainer: doc.body,
      draggable: false,
      resizable: true,
      rotatable: false,
      renderDirections: ['n', 'nw', 'ne', 's', 'se', 'sw', 'e', 'w'],
      keepRatio: false,
      origin: false,
      snappable: false,
      className: 're-crop-frame'
    })
    frameBox.on('resize', (e) => {
      const before = readRect(frame)
      frame.style.width = `${Math.max(12, e.width)}px`
      frame.style.height = `${Math.max(12, e.height)}px`
      frame.style.left = `${e.drag.left}px`
      frame.style.top = `${e.drag.top}px`
      // cropping moves the frame, never the picture: compensate the
      // picture's frame-relative offset by the frame's displacement
      const rect = readRect(img)
      writeRect(img, {
        ...rect,
        left: rect.left - (e.drag.left - before.left),
        top: rect.top - (e.drag.top - before.top)
      })
      mutated = true
      sync(img)
      pictureBox?.updateRect()
    })

    pictureBox = new Moveable(doc.body, {
      target: img,
      rootContainer: doc.body,
      draggable: true,
      resizable: true,
      rotatable: false,
      renderDirections: ['nw', 'ne', 'se', 'sw'],
      keepRatio: true,
      origin: false,
      snappable: false,
      className: 're-crop-picture'
    })
    pictureBox
      .on('drag', (e) => {
        img.style.left = `${e.left}px`
        img.style.top = `${e.top}px`
        mutated = true
        sync(img)
      })
      .on('resize', (e) => {
        img.style.width = `${Math.max(12, e.width)}px`
        img.style.height = `${Math.max(12, e.height)}px`
        img.style.left = `${e.drag.left}px`
        img.style.top = `${e.drag.top}px`
        mutated = true
        sync(img)
        frameBox?.updateRect()
      })
      .on('dragEnd', () => frameBox?.updateRect())

    doc.addEventListener('mousedown', onOutsidePress, true)
    for (const win of [window, bridge.win]) win.addEventListener('keydown', onKey, true)
    return frame
  }

  // The framed region at full opacity: a clipping clone kept in sync with
  // the real (dimmed) picture.
  function buildView(img) {
    view = doc.createElement('div')
    view.className = 're-transient re-crop-view'
    viewImg = doc.createElement('img')
    viewImg.src = img.getAttribute('src') ?? img.src
    viewImg.alt = ''
    view.appendChild(viewImg)
    frame.appendChild(view)
    sync(img)
  }

  function sync(img) {
    if (viewImg) writeRect(viewImg, readRect(img))
  }

  function onOutsidePress(e) {
    const t = e.target
    if (frame.contains(t) || t.closest?.('.moveable-control-box')) return
    commit()
  }

  function onKey(e) {
    if (e.key !== 'Escape' && e.key !== 'Enter') return
    e.preventDefault()
    e.stopImmediatePropagation()
    commit()
  }

  function teardown() {
    doc.removeEventListener('mousedown', onOutsidePress, true)
    for (const win of [window, bridge.win]) win.removeEventListener('keydown', onKey, true)
    frameBox?.destroy()
    pictureBox?.destroy()
    frameBox = pictureBox = null
    view?.remove()
    view = viewImg = null
    frame?.classList.remove('re-cropping')
    frame = null
  }

  function commit() {
    if (!frame) return
    const done = frame
    const img = imageOf(done)
    const restore = pristine
    pristine = null
    teardown()
    if (!done.isConnected) return // deleted mid-crop; nothing to commit
    if (!mutated) {
      // nothing was cropped: put back exactly what was there before
      let el = done
      if (restore) {
        el = unwrapImage(done)
        if (restore.class != null) el.setAttribute('class', restore.class)
        else el.removeAttribute('class')
        if (restore.style != null) el.setAttribute('style', restore.style)
        else el.removeAttribute('style')
      }
      onDone?.(el, false)
      return
    }
    roundGeometry(done)
    if (img) roundGeometry(img)
    const el = isTrivialCrop(done) ? unwrapImage(done) : done
    onDone?.(el, true)
  }

  return { start, commit, active }
}

function injectStyles(doc) {
  if (doc.getElementById(CROP_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = CROP_STYLE_ID
  style.textContent = `
    /* reveal-editor crop mode (runtime only, never saved) */
    .re-image-frame.re-cropping { overflow: visible !important; }
    .re-image-frame.re-cropping > img { opacity: .35; }
    .re-crop-view {
      position: absolute; inset: 0; overflow: hidden; pointer-events: none;
    }
    .re-crop-view img {
      position: absolute; max-width: none; max-height: none; margin: 0;
    }
    /* frame handles: dark PowerPoint-style crop bars */
    .moveable-control-box.re-crop-frame .moveable-control {
      width: 14px; height: 14px; margin-top: -7px; margin-left: -7px;
      background: #1c1d22; border: 2px solid #fff; border-radius: 3px;
    }
    .moveable-control-box.re-crop-frame .moveable-line {
      background: #1c1d22;
    }
    /* picture handles: round, lighter */
    .moveable-control-box.re-crop-picture .moveable-control {
      background: #fff; border: 2px solid #3574c4; border-radius: 50%;
    }
    .moveable-control-box.re-crop-picture .moveable-line {
      background: rgba(53, 116, 196, .55);
    }
  `
  doc.head.appendChild(style)
}
