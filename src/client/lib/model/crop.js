// Image cropping model (PowerPoint-style). A cropped image is a clipping
// frame — <div class="re-el re-image-frame" style="overflow:hidden"> —
// around an absolutely positioned inner <img>. The frame carries the canvas
// geometry and the decorations (border, radius, shadow, rotation); the
// img's offset and size relative to the frame decide which part of the
// picture shows. An uncropped image stays a bare <img class="re-el">; the
// frame exists only while a crop is in effect, so decks without crops keep
// their original markup.

// Styles that belong to the outer element (the frame while cropped, the
// bare img otherwise) rather than to the picture itself.
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

/** The <img> of an image element: the element itself, or a frame's picture. */
export function imageOf(el) {
  if (!el) return null
  if (el.tagName === 'IMG') return el
  if (isImageFrame(el)) return el.querySelector(':scope > img')
  return null
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
function pictureRect(img, w, h) {
  const view = img.ownerDocument.defaultView
  const fit = view?.getComputedStyle?.(img).objectFit || img.style.objectFit || 'fill'
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!(nw > 0 && nh > 0) || (fit !== 'cover' && fit !== 'contain')) {
    return { left: 0, top: 0, width: w, height: h }
  }
  const scale = fit === 'cover' ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh)
  const position = (img.style.objectPosition || '50% 50%').split(/\s+/)
  const px = Number.isFinite(parseFloat(position[0])) ? parseFloat(position[0]) : 50
  const py = Number.isFinite(parseFloat(position[1])) ? parseFloat(position[1]) : 50
  return {
    left: (w - nw * scale) * px / 100,
    top: (h - nh * scale) * py / 100,
    width: nw * scale,
    height: nh * scale
  }
}

/**
 * Convert a bare <img> into the frame representation without changing what
 * is rendered (existing object-fit crops become picture geometry). No-op if
 * already a frame.
 */
export function wrapImage(el) {
  if (isImageFrame(el)) return el
  const img = el
  const doc = img.ownerDocument
  const frame = doc.createElement('div')
  frame.className = 're-el re-image-frame'
  const w = parseFloat(img.style.width) || img.getBoundingClientRect().width || img.naturalWidth || 100
  const h = parseFloat(img.style.height) || img.getBoundingClientRect().height || img.naturalHeight || 100
  frame.style.position = 'absolute'
  frame.style.left = img.style.left || '0px'
  frame.style.top = img.style.top || '0px'
  frame.style.width = `${w}px`
  frame.style.height = `${h}px`
  frame.style.overflow = 'hidden'
  moveStyles(img, frame)

  const rect = pictureRect(img, w, h)
  img.classList.remove('re-el')
  if (!img.getAttribute('class')) img.removeAttribute('class')
  img.style.position = 'absolute'
  writeRect(img, rect)
  // reveal themes cap section images (max-width/height); the picture must
  // be sizable past its frame
  img.style.maxWidth = 'none'
  img.style.maxHeight = 'none'
  img.style.margin = '0'
  img.style.removeProperty('object-fit')
  img.style.removeProperty('object-position')

  img.before(frame)
  frame.appendChild(img)
  return frame
}

/**
 * Dissolve a frame back into a bare <img> placed at `rect` (canvas px;
 * defaults to the frame's own rectangle). Returns the img.
 */
export function unwrapImage(frame, rect = readRect(frame)) {
  const img = imageOf(frame)
  if (!img) return frame
  moveStyles(frame, img)
  img.classList.add('re-el')
  img.style.position = 'absolute'
  writeRect(img, rect)
  img.style.removeProperty('max-width')
  img.style.removeProperty('max-height')
  frame.before(img)
  frame.remove()
  return img
}

/** Undo the crop entirely: the full picture at its current on-canvas rect. */
export function removeCrop(frame) {
  const img = imageOf(frame)
  if (!img) return frame
  const f = readRect(frame)
  const r = readRect(img)
  return unwrapImage(frame, {
    left: f.left + r.left,
    top: f.top + r.top,
    width: r.width,
    height: r.height
  })
}

/** True when the frame shows the whole picture, i.e. nothing is cropped. */
export function isTrivialCrop(frame) {
  const img = imageOf(frame)
  if (!img) return true
  const f = readRect(frame)
  const r = readRect(img)
  return Math.abs(r.left) < 0.75 && Math.abs(r.top) < 0.75 &&
    Math.abs(r.width - f.width) < 1.5 && Math.abs(r.height - f.height) < 1.5
}

/**
 * Keep the crop while the frame is resized: scale the picture by the same
 * factors as the frame, from the geometry captured at gesture start
 * (`start = { frame, img }` rects).
 */
export function resizeFrameContents(frame, start, width, height) {
  const img = imageOf(frame)
  if (!img) return
  const sx = width / (start.frame.width || 1)
  const sy = height / (start.frame.height || 1)
  writeRect(img, {
    left: start.img.left * sx,
    top: start.img.top * sy,
    width: start.img.width * sx,
    height: start.img.height * sy
  })
}
