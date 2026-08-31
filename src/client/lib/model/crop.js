// Media cropping model (PowerPoint-style). A cropped image or video is a
// clipping frame — <div class="re-el re-image-frame" style="overflow:hidden">
// — around an absolutely positioned inner <img> or <video>. The frame
// carries the canvas geometry and the decorations (border, radius, shadow,
// rotation); the picture's offset and size relative to the frame decide
// which part of it shows. Uncropped media stays a bare <img>/<video
// class="re-el">; the frame exists only while a crop is in effect, so decks
// without crops keep their original markup.

// Styles that belong to the outer element (the frame while cropped, the
// bare picture otherwise) rather than to the picture itself.
const DECORATION_PROPS = [
  'transform', 'border-width', 'border-style', 'border-color',
  'border-radius', 'box-shadow', 'z-index'
]
// Attributes with the same outer-element contract (selection, layers).
const DECORATION_ATTRS = ['data-re-lock-ratio', 'data-re-locked', 'data-re-hidden']

const GEOMETRY_PROPS = ['left', 'top', 'width', 'height']

export function isImageFrame(el) {
  return Boolean(el?.classList?.contains('re-image-frame'))
}

/**
 * The <img>/<video> of a media element: the element itself, or a frame's
 * picture.
 */
export function mediaOf(el) {
  if (!el) return null
  if (el.tagName === 'IMG' || el.tagName === 'VIDEO') return el
  if (isImageFrame(el)) return el.querySelector(':scope > img, :scope > video')
  return null
}

/** The <img> of an image element, or null for anything else. */
export function imageOf(el) {
  const media = mediaOf(el)
  return media?.tagName === 'IMG' ? media : null
}

/** The <video> of a video element, or null for anything else. */
export function videoOf(el) {
  const media = mediaOf(el)
  return media?.tagName === 'VIDEO' ? media : null
}

/**
 * The intrinsic pixel size of a picture, zero until it has loaded (a video's
 * metadata, an image's bitmap).
 */
export function intrinsicSize(media) {
  return media?.tagName === 'VIDEO'
    ? { width: media.videoWidth || 0, height: media.videoHeight || 0 }
    : { width: media?.naturalWidth || 0, height: media?.naturalHeight || 0 }
}

export function readRect(el) {
  const rect = {}
  for (const prop of GEOMETRY_PROPS) rect[prop] = parseFloat(el.style[prop]) || 0
  return rect
}

export function writeRect(el, rect) {
  for (const prop of GEOMETRY_PROPS) {
    if (rect[prop] != null) el.style[prop] = `${rect[prop]}px`
  }
}

/** The rotation (degrees) of an element's inline transform, 0 if none. */
export function rotationOf(el) {
  return parseFloat(el?.style.transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1]) || 0
}

function moveStyles(from, to) {
  for (const prop of DECORATION_PROPS) {
    const value = from.style.getPropertyValue(prop)
    if (value) {
      to.style.setProperty(prop, value)
      from.style.removeProperty(prop)
    }
  }
  for (const attr of DECORATION_ATTRS) {
    if (from.hasAttribute(attr)) {
      to.setAttribute(attr, from.getAttribute(attr))
      from.removeAttribute(attr)
    }
  }
}

/**
 * The picture rectangle (relative to a w×h frame) that reproduces the
 * element's current object-fit/object-position rendering exactly.
 */
function pictureRect(media, w, h) {
  const view = media.ownerDocument.defaultView
  // <video> letterboxes by default (the HTML rendering spec gives it
  // object-fit: contain), <img> stretches
  const initialFit = media.tagName === 'VIDEO' ? 'contain' : 'fill'
  const fit = view?.getComputedStyle?.(media).objectFit || media.style.objectFit || initialFit
  const { width: nw, height: nh } = intrinsicSize(media)
  if (!(nw > 0 && nh > 0) || (fit !== 'cover' && fit !== 'contain')) {
    return { left: 0, top: 0, width: w, height: h }
  }
  const scale = fit === 'cover' ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh)
  // computed style resolves position keywords to percentages; the inline
  // fallback covers environments without computed object-position
  const position = (view?.getComputedStyle?.(media).objectPosition ||
    media.style.objectPosition || '50% 50%').split(/\s+/)
  return {
    left: positionOffset(position[0], w - nw * scale),
    top: positionOffset(position[1], h - nh * scale),
    width: nw * scale,
    height: nh * scale
  }
}

const POSITION_KEYWORDS = { left: 0, top: 0, center: 50, right: 100, bottom: 100 }

/**
 * One object-position component as a px offset over the given free space
 * (frame size minus picture size). Percentages distribute the free space;
 * px values are edge offsets, per the CSS object-position spec.
 */
function positionOffset(raw, extent) {
  if (raw in POSITION_KEYWORDS) return extent * POSITION_KEYWORDS[raw] / 100
  const value = parseFloat(raw)
  if (!Number.isFinite(value)) return extent / 2
  return /px$/.test(raw) ? value : extent * value / 100
}

/**
 * Convert a bare <img>/<video> into the frame representation without
 * changing what is rendered (existing object-fit crops become picture
 * geometry). No-op if already a frame.
 */
export function wrapImage(el) {
  if (isImageFrame(el)) return el
  const media = el
  const doc = media.ownerDocument
  const frame = doc.createElement('div')
  frame.className = 're-el re-image-frame'
  const intrinsic = intrinsicSize(media)
  // offsetWidth/Height are layout px — canvas px here — unlike
  // getBoundingClientRect, which the edit canvas's CSS scale would distort
  const w = parseFloat(media.style.width) || media.offsetWidth || intrinsic.width || 100
  const h = parseFloat(media.style.height) || media.offsetHeight || intrinsic.height || 100
  frame.style.position = 'absolute'
  frame.style.left = media.style.left || '0px'
  frame.style.top = media.style.top || '0px'
  frame.style.width = `${w}px`
  frame.style.height = `${h}px`
  frame.style.overflow = 'hidden'
  moveStyles(media, frame)

  const rect = pictureRect(media, w, h)
  media.classList.remove('re-el')
  if (!media.getAttribute('class')) media.removeAttribute('class')
  media.style.position = 'absolute'
  writeRect(media, rect)
  // reveal themes cap section media (max-width/height); the picture must
  // be sizable past its frame
  media.style.maxWidth = 'none'
  media.style.maxHeight = 'none'
  media.style.margin = '0'
  media.style.removeProperty('object-fit')
  media.style.removeProperty('object-position')

  media.before(frame)
  frame.appendChild(media)
  return frame
}

/**
 * Dissolve a frame back into a bare <img>/<video> placed at `rect` (canvas
 * px; defaults to the frame's own rectangle). Returns the picture.
 */
export function unwrapImage(frame, rect = readRect(frame)) {
  const media = mediaOf(frame)
  if (!media) return frame
  moveStyles(frame, media)
  media.classList.add('re-el')
  media.style.position = 'absolute'
  writeRect(media, rect)
  media.style.removeProperty('max-width')
  media.style.removeProperty('max-height')
  frame.before(media)
  frame.remove()
  return media
}

/** Undo the crop entirely: the full picture at its current on-canvas rect. */
export function removeCrop(frame) {
  const media = mediaOf(frame)
  if (!media) return frame
  const f = readRect(frame)
  const r = readRect(media)
  const rect = { left: f.left + r.left, top: f.top + r.top, width: r.width, height: r.height }
  // a rotated frame spins about its own center while the restored picture
  // spins about its (different) center: shift so the rendering stays put
  const angle = rotationOf(frame) * Math.PI / 180
  if (angle) {
    const dx = rect.left + r.width / 2 - (f.left + f.width / 2)
    const dy = rect.top + r.height / 2 - (f.top + f.height / 2)
    rect.left += dx * Math.cos(angle) - dy * Math.sin(angle) - dx
    rect.top += dx * Math.sin(angle) + dy * Math.cos(angle) - dy
  }
  return unwrapImage(frame, rect)
}

/** True when the frame shows the whole picture, i.e. nothing is cropped. */
export function isTrivialCrop(frame) {
  const media = mediaOf(frame)
  if (!media) return true
  const f = readRect(frame)
  const r = readRect(media)
  return Math.abs(r.left) < 0.75 && Math.abs(r.top) < 0.75 &&
    Math.abs(r.width - f.width) < 1.5 && Math.abs(r.height - f.height) < 1.5
}

/**
 * Keep the crop while the frame is resized: scale the picture by the same
 * factors as the frame, from the geometry captured at gesture start
 * (`start = { frame, media }` rects).
 */
export function resizeFrameContents(frame, start, width, height) {
  const media = mediaOf(frame)
  if (!media) return
  const sx = width / (start.frame.width || 1)
  const sy = height / (start.frame.height || 1)
  writeRect(media, {
    left: start.media.left * sx,
    top: start.media.top * sy,
    width: start.media.width * sx,
    height: start.media.height * sy
  })
}
