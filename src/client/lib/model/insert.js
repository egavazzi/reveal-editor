// Element insertion. New elements land near the canvas center of the
// current slide (cascading slightly so repeated inserts don't stack
// exactly), positioned in canvas px.
import { getCanvasSize } from '../overlay/editmode.js'
import { createShape, SHAPE_DEFAULTS } from './shapes.js'
import { uploadAsset } from '../api.js'

let cascade = 0

function placeAt(bridge, el, width, height) {
  const { width: cw, height: ch } = getCanvasSize(bridge)
  const offset = (cascade++ % 5) * 24
  el.style.position = 'absolute'
  el.style.left = `${Math.round((cw - width) / 2) + offset}px`
  el.style.top = `${Math.round((ch - height) / 2) + offset}px`
  const section = bridge.currentSection
  section.appendChild(el)
  return el
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
 * fit comfortably on the canvas at natural aspect ratio.
 */
export async function insertImageBlob(bridge, blob, name) {
  const { path } = await uploadAsset(blob, name)
  const doc = bridge.doc
  const natural = await new Promise((resolvePromise, reject) => {
    const probe = new bridge.win.Image()
    probe.onload = () => resolvePromise({ w: probe.naturalWidth, h: probe.naturalHeight })
    probe.onerror = reject
    probe.src = path
  })
  const { width: cw, height: ch } = getCanvasSize(bridge)
  const scale = Math.min(1, (cw * 0.5) / natural.w, (ch * 0.6) / natural.h)
  const w = Math.round(natural.w * scale)
  const h = Math.round(natural.h * scale)

  const img = doc.createElement('img')
  img.className = 're-el'
  img.src = path
  img.style.width = `${w}px`
  img.style.height = `${h}px`
  return placeAt(bridge, img, w, h)
}

/** Upload and insert an HTML5 video with its intrinsic aspect ratio. */
export async function insertVideoBlob(bridge, blob, name) {
  const { path } = await uploadAsset(blob, name)
  const doc = bridge.doc
  const natural = await new Promise((resolvePromise, reject) => {
    const probe = doc.createElement('video')
    probe.onloadedmetadata = () => resolvePromise({
      w: probe.videoWidth || 640,
      h: probe.videoHeight || 360
    })
    probe.onerror = reject
    probe.preload = 'metadata'
    probe.src = path
  })
  const { width: cw, height: ch } = getCanvasSize(bridge)
  const scale = Math.min(1, (cw * 0.6) / natural.w, (ch * 0.6) / natural.h)
  const w = Math.round(natural.w * scale)
  const h = Math.round(natural.h * scale)
  const video = doc.createElement('video')
  video.className = 're-el'
  video.src = path
  video.controls = true
  video.preload = 'metadata'
  video.style.width = `${w}px`
  video.style.height = `${h}px`
  return placeAt(bridge, video, w, h)
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

/** Extract an image blob from a paste event, if any. */
export function imageFromClipboard(event) {
  for (const item of event.clipboardData?.items ?? []) {
    if (item.type.startsWith('image/')) return item.getAsFile()
  }
  return null
}
