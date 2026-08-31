// PowerPoint-style crop mode for images and videos. While active, the full
// picture shows dimmed behind the frame with the framed part at full
// opacity. Dragging the frame's edge handles crops (the picture stays put on
// the canvas), dragging the picture pans it inside the frame, and the
// picture's corner handles zoom it. Enter/Escape or clicking elsewhere
// commits.
import Moveable from 'moveable'
import {
  mediaOf, isImageFrame, wrapImage, unwrapImage, isTrivialCrop, readRect, writeRect, rotationOf
} from '../model/crop.js'
import { roundGeometry } from '../model/position.js'

const CROP_STYLE_ID = 're-crop-style'

export function createCropMode(bridge, { onDone }) {
  const doc = bridge.doc
  let frame = null
  let frameBox = null
  let pictureBox = null
  let view = null
  let viewMedia = null
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
    const media = mediaOf(frame)
    // the cropped picture must hold still while it is being framed
    if (media.tagName === 'VIDEO') media.pause()
    frame.classList.add('re-cropping')
    buildView(media)

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
    // clamping through Moveable keeps e.drag consistent with the clamped
    // size (a bare Math.max would desync the anchored edge)
    frameBox.on('resizeStart', (e) => e.setMin([12, 12]))
    frameBox.on('resize', (e) => {
      const before = readRect(frame)
      frame.style.width = `${e.width}px`
      frame.style.height = `${e.height}px`
      frame.style.left = `${e.drag.left}px`
      frame.style.top = `${e.drag.top}px`
      // cropping moves the frame, never the picture: compensate the
      // picture's frame-local offset for the frame's displacement — the
      // frame-center shift, mapped into the frame's (possibly rotated) axes
      const after = readRect(frame)
      const rect = readRect(media)
      const angle = -rotationOf(frame) * Math.PI / 180
      const cdx = after.left - before.left + (after.width - before.width) / 2
      const cdy = after.top - before.top + (after.height - before.height) / 2
      writeRect(media, {
        ...rect,
        left: rect.left + (after.width - before.width) / 2 -
          (cdx * Math.cos(angle) - cdy * Math.sin(angle)),
        top: rect.top + (after.height - before.height) / 2 -
          (cdx * Math.sin(angle) + cdy * Math.cos(angle))
      })
      mutated = true
      sync(media)
      pictureBox?.updateRect()
    })

    pictureBox = new Moveable(doc.body, {
      target: media,
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
        media.style.left = `${e.left}px`
        media.style.top = `${e.top}px`
        mutated = true
        sync(media)
      })
      .on('resizeStart', (e) => e.setMin([12, 12]))
      .on('resize', (e) => {
        media.style.width = `${e.width}px`
        media.style.height = `${e.height}px`
        media.style.left = `${e.drag.left}px`
        media.style.top = `${e.drag.top}px`
        mutated = true
        sync(media)
        frameBox?.updateRect()
      })
      .on('dragEnd', () => frameBox?.updateRect())

    doc.addEventListener('mousedown', onOutsidePress, true)
    for (const win of [window, bridge.win]) win.addEventListener('keydown', onKey, true)
    return frame
  }

  // The framed region at full opacity: a clipping clone kept in sync with
  // the real (dimmed) picture.
  function buildView(media) {
    view = doc.createElement('div')
    view.className = 're-transient re-crop-view'
    viewMedia = media.tagName === 'VIDEO' ? videoClone(media) : imageClone(media)
    view.appendChild(viewMedia)
    frame.appendChild(view)
    sync(media)
  }

  function imageClone(img) {
    const clone = doc.createElement('img')
    clone.src = img.getAttribute('src') ?? img.src
    clone.alt = ''
    return clone
  }

  // A silent, inert still of the video at the frame it is paused on. The
  // clone carries any <source> children, and seeks again once its own
  // metadata has loaded — a fresh element starts at zero.
  function videoClone(video) {
    const clone = video.cloneNode(true)
    clone.removeAttribute('class')
    clone.removeAttribute('style')
    clone.removeAttribute('controls')
    clone.removeAttribute('autoplay')
    clone.removeAttribute('data-autoplay')
    clone.removeAttribute('loop')
    clone.muted = true
    clone.preload = 'auto'
    const seek = () => { clone.currentTime = video.currentTime }
    clone.addEventListener('loadedmetadata', seek, { once: true })
    seek()
    return clone
  }

  function sync(media) {
    if (viewMedia) writeRect(viewMedia, readRect(media))
  }

  function onOutsidePress(e) {
    const t = e.target
    if (frame.contains(t) || t.closest?.('.moveable-control-box')) return
    commit()
  }

  function onKey(e) {
    if (e.key !== 'Escape' && e.key !== 'Enter') return
    // keys typed into a form field (the Inspector panels) keep their
    // native behavior; crop mode only claims keys pressed on the canvas
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' || t.isContentEditable)) return
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
    view = viewMedia = null
    frame?.classList.remove('re-cropping')
    frame = null
  }

  function commit() {
    if (!frame) return
    const done = frame
    const media = mediaOf(done)
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
    if (media) roundGeometry(media)
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
    .re-image-frame.re-cropping > img,
    .re-image-frame.re-cropping > video { opacity: .35; }
    /* edit mode makes videos pointer-inert; the picture being cropped must
       still take the drags that pan and zoom it */
    .re-image-frame.re-cropping > video { pointer-events: auto !important; }
    /* the frame's own control bar would sit on top of the crop handles */
    .re-image-frame.re-cropping > .re-video-controls { display: none; }
    .re-crop-view {
      position: absolute; inset: 0; overflow: hidden; pointer-events: none;
    }
    .re-crop-view img, .re-crop-view video {
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
