// Element insertion. New elements land near the canvas center of the
// current slide (cascading slightly so repeated inserts don't stack
// exactly), positioned in canvas px.
import { getCanvasSize } from '../overlay/editmode.js'
import { createShape, SHAPE_DEFAULTS } from './shapes.js'
import { uploadAsset } from '../api.js'
import { VIDEO_CONTROLS_ATTR } from './videocontrols.js'

let cascade = 0

/**
 * Append `el` to a slide (`section`, default the current one) centred on
 * `center` in canvas px — kept inside the canvas — or, without one, near
 * the canvas centre with the cascade offset.
 */
function placeAt(bridge, el, width, height, { center, section = bridge.currentSection } = {}) {
  const { width: cw, height: ch } = getCanvasSize(bridge)
  let left, top
  if (center) {
    left = Math.min(Math.max(0, center.x - width / 2), Math.max(0, cw - width))
    top = Math.min(Math.max(0, center.y - height / 2), Math.max(0, ch - height))
  } else {
    const offset = (cascade++ % 5) * 24
    left = (cw - width) / 2 + offset
    top = (ch - height) / 2 + offset
  }
  el.style.position = 'absolute'
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
  if (!section.isConnected) throw new Error('the slide it was meant for no longer exists')
  section.appendChild(el)
  return el
}

/**
 * A box on the slide, where the media will land, showing that a conversion
 * is running: dashed frame, spinner, file name, and a progress bar once
 * `setProgress` is called with a fraction. Editor-only (`.re-transient`):
 * never saved, never selectable. `center` is where the converted media
 * should be placed to take the box's spot.
 */
function showConvertingBox(bridge, name, width, height, { center, section }) {
  const doc = bridge.doc
  const box = doc.createElement('div')
  box.className = 're-transient re-converting'
  box.style.width = `${width}px`
  box.style.height = `${height}px`
  const spinner = doc.createElement('div')
  spinner.className = 're-spinner'
  const label = doc.createElement('div')
  label.className = 're-label'
  label.textContent = `Converting ${name}…`
  const bar = doc.createElement('div')
  bar.className = 're-progress'
  bar.hidden = true
  const fill = doc.createElement('span')
  bar.appendChild(fill)
  box.append(spinner, label, bar)
  placeAt(bridge, box, width, height, { center, section })
  return {
    center: {
      x: parseFloat(box.style.left) + width / 2,
      y: parseFloat(box.style.top) + height / 2
    },
    setProgress(fraction) {
      bar.hidden = false
      fill.style.width = `${Math.round(fraction * 100)}%`
      label.textContent = `Converting ${name}… ${Math.round(fraction * 100)}%`
    },
    remove() {
      box.remove()
    }
  }
}

export function insertTextBox(bridge) {
  const doc = bridge.doc
  const el = doc.createElement('div')
  el.className = 're-el re-text'
  el.style.width = '360px'
  const p = doc.createElement('p')
  p.textContent = 'Text'
  el.appendChild(p)
  return placeAt(bridge, el, 360, 60)
}

export function insertShape(bridge, kind) {
  const el = createShape(bridge.doc, kind)
  const { width, height } = SHAPE_DEFAULTS[kind]
  return placeAt(bridge, el, width, height)
}

/**
 * Upload an image blob to the deck's assets/ dir and insert it, scaled to
 * fit comfortably on the canvas at natural aspect ratio. When the browser
 * cannot decode the file, `convert(path, name, { onProgress })` gets a chance to produce a
 * displayable copy; the insert fails when it cannot. The image lands on the
 * slide that is current when this is called (the user may move on during
 * a long conversion), centred on `at` (canvas px) when given.
 * `beforeInsert(section)` runs just before the element is appended.
 */
export async function insertImageBlob(bridge, blob, name, { convert, at, beforeInsert } = {}) {
  const section = bridge.currentSection
  const upload = await uploadAsset(blob, name)
  let path = upload.path
  const doc = bridge.doc
  const measure = (src) => new Promise((resolvePromise, reject) => {
    const probe = new bridge.win.Image()
    probe.onload = () => resolvePromise({ w: probe.naturalWidth, h: probe.naturalHeight })
    probe.onerror = () => reject(new Error(`this browser can't display ${name}`))
    probe.src = src
  })
  let natural
  let center = at
  try {
    natural = await measure(path)
  } catch (err) {
    if (!convert) throw err
    const box = showConvertingBox(bridge, name, 400, 300, { center, section })
    try {
      const converted = await convert(path, name, { onProgress: box.setProgress })
      if (!converted) throw err
      path = converted
      natural = await measure(path)
      center = box.center
    } finally {
      box.remove()
    }
  }
  const { width: cw, height: ch } = getCanvasSize(bridge)
  const scale = Math.min(1, (cw * 0.5) / natural.w, (ch * 0.6) / natural.h)
  const w = Math.round(natural.w * scale)
  const h = Math.round(natural.h * scale)

  const img = doc.createElement('img')
  img.className = 're-el'
  img.src = path
  img.style.width = `${w}px`
  img.style.height = `${h}px`
  beforeInsert?.(section)
  return placeAt(bridge, img, w, h, { center, section })
}

/**
 * Upload and insert an HTML5 video with its intrinsic aspect ratio. When
 * the browser can't decode the file, `convert(path, name, { onProgress })` gets a chance to
 * produce a playable copy. The video lands on the slide that is current
 * when this is called (the user may move on during a long conversion),
 * centred on `at` (canvas px) when given. `beforeInsert(section)` runs
 * just before the element is appended.
 */
export async function insertVideoBlob(bridge, blob, name, { convert, at, beforeInsert } = {}) {
  const section = bridge.currentSection
  const upload = await uploadAsset(blob, name)
  let path = upload.path
  const doc = bridge.doc
  const measure = (src) => new Promise((resolvePromise, reject) => {
    const probe = doc.createElement('video')
    probe.onloadedmetadata = () => resolvePromise({
      w: probe.videoWidth || 640,
      h: probe.videoHeight || 360
    })
    probe.onerror = () => reject(new Error(`this browser can't play ${name}`))
    probe.preload = 'metadata'
    probe.src = src
  })
  let natural
  let center = at
  try {
    natural = await measure(path)
  } catch {
    // Undecodable here: convert if we can, otherwise insert the original
    // anyway (another browser may play it); the video panel explains.
    if (convert) {
      const box = showConvertingBox(bridge, name, 480, 270, { center, section })
      try {
        const converted = await convert(path, name, { onProgress: box.setProgress })
        if (converted) {
          path = converted
          natural = await measure(path).catch(() => ({ w: 640, h: 360 }))
        }
        center = box.center
      } finally {
        box.remove()
      }
    }
    natural ??= { w: 640, h: 360 }
  }
  const { width: cw, height: ch } = getCanvasSize(bridge)
  const scale = Math.min(1, (cw * 0.6) / natural.w, (ch * 0.6) / natural.h)
  const w = Math.round(natural.w * scale)
  const h = Math.round(natural.h * scale)
  const video = doc.createElement('video')
  video.className = 're-el'
  video.src = path
  // the deck runtime draws the controls, on the picture rather than on the
  // element's box
  video.setAttribute(VIDEO_CONTROLS_ATTR, '')
  video.preload = 'metadata'
  video.style.width = `${w}px`
  video.style.height = `${h}px`
  beforeInsert?.(section)
  return placeAt(bridge, video, w, h, { center, section })
}

export function insertMathBox(bridge) {
  const doc = bridge.doc
  const el = doc.createElement('div')
  el.className = 're-el re-math'
  el.style.fontSize = '40px'
  el.textContent = '\\(E = mc^2\\)'
  return placeAt(bridge, el, 240, 60)
}

export function insertCodeBlock(bridge) {
  const doc = bridge.doc
  const pre = doc.createElement('pre')
  pre.className = 're-el'
  pre.style.width = '600px'
  pre.style.margin = '0'
  const code = doc.createElement('code')
  code.className = 'language-julia'
  code.textContent = 'function f(x)\n    return x .^ 2\nend'
  pre.appendChild(code)
  return placeAt(bridge, pre, 600, 160)
}

export function insertHtmlBlock(bridge) {
  const doc = bridge.doc
  const el = doc.createElement('div')
  el.className = 're-el re-html'
  el.style.width = '600px'
  el.style.height = '320px'
  el.style.overflow = 'auto'
  el.innerHTML = '<div style="padding: 24px; border: 2px solid currentColor">Custom HTML</div>'
  return placeAt(bridge, el, 600, 320)
}

/** Extract an image blob from a paste event, if any. */
export function imageFromClipboard(event) {
  for (const item of event.clipboardData?.items ?? []) {
    if (item.type.startsWith('image/')) return item.getAsFile()
  }
  return null
}
