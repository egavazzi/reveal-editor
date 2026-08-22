// SVG shape primitives. Shapes are plain <svg data-shape="…"> elements with
// explicit inner geometry (no CSS-scaled viewBox tricks), so strokes stay
// crisp and the saved markup is obvious to hand-edit. On resize the editor
// rewrites the geometry via syncShapeGeometry.

const STROKE = '#2f6fba'
const FILL = '#dbe9f8'
const STROKE_WIDTH = 3

export const SHAPE_DEFAULTS = {
  rect: { width: 240, height: 160 },
  ellipse: { width: 240, height: 160 },
  // A line's box describes its two endpoints at opposite corners.
  // Starting one pixel high makes the initial line visually horizontal while
  // still giving Moveable two distinct endpoint handles.
  line: { width: 300, height: 1 },
  arrow: { width: 300, height: 1 }
}

export function createShape(doc, kind) {
  const { width, height } = SHAPE_DEFAULTS[kind]
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 're-el')
  svg.setAttribute('data-shape', kind)
  if (kind === 'line' || kind === 'arrow') svg.setAttribute('data-re-line-start', 'nw')
  svg.style.width = `${width}px`
  svg.style.height = `${height}px`
  svg.style.overflow = 'visible'
  svg.appendChild(buildGeometry(doc, kind, width, height))
  syncShapeGeometry(svg)
  return svg
}

function buildGeometry(doc, kind, w, h) {
  const ns = 'http://www.w3.org/2000/svg'
  let el
  switch (kind) {
    case 'rect':
      el = doc.createElementNS(ns, 'rect')
      el.setAttribute('fill', FILL)
      el.setAttribute('stroke', STROKE)
      el.setAttribute('stroke-width', STROKE_WIDTH)
      el.setAttribute('rx', 6)
      break
    case 'ellipse':
      el = doc.createElementNS(ns, 'ellipse')
      el.setAttribute('fill', FILL)
      el.setAttribute('stroke', STROKE)
      el.setAttribute('stroke-width', STROKE_WIDTH)
      break
    case 'line':
      el = doc.createElementNS(ns, 'line')
      el.setAttribute('stroke', STROKE)
      el.setAttribute('stroke-width', STROKE_WIDTH)
      break
    case 'arrow':
      el = doc.createElementNS(ns, 'g')
      el.setAttribute('stroke', STROKE)
      el.setAttribute('fill', STROKE)
      el.appendChild(doc.createElementNS(ns, 'line'))
      el.appendChild(doc.createElementNS(ns, 'polygon'))
      el.querySelector('line').setAttribute('stroke-width', STROKE_WIDTH)
      break
  }
  return el
}

/**
 * Rewrite the inner geometry of a shape svg to match its current CSS size.
 * Called live during resize and on commit.
 */
export function syncShapeGeometry(svg) {
  const kind = svg.getAttribute('data-shape')
  if (!kind) return
  const w = Math.max(1, Math.round(parseFloat(svg.style.width) || svg.clientWidth))
  const h = Math.max(1, Math.round(parseFloat(svg.style.height) || svg.clientHeight))
  const strokeWidth = readStrokeWidth(svg.firstElementChild)
  const inset = strokeWidth / 2
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.setAttribute('width', w)
  svg.setAttribute('height', h)

  switch (kind) {
    case 'rect': {
      const rect = svg.querySelector('rect')
      rect.setAttribute('x', inset)
      rect.setAttribute('y', inset)
      rect.setAttribute('width', Math.max(1, w - strokeWidth))
      rect.setAttribute('height', Math.max(1, h - strokeWidth))
      break
    }
    case 'ellipse': {
      const el = svg.querySelector('ellipse')
      el.setAttribute('cx', w / 2)
      el.setAttribute('cy', h / 2)
      el.setAttribute('rx', Math.max(1, (w - strokeWidth) / 2))
      el.setAttribute('ry', Math.max(1, (h - strokeWidth) / 2))
      break
    }
    case 'line': {
      const el = svg.querySelector('line')
      const { x1, y1, x2, y2 } = lineEndpoints(svg, w, h)
      el.setAttribute('x1', x1)
      el.setAttribute('y1', y1)
      el.setAttribute('x2', x2)
      el.setAttribute('y2', y2)
      break
    }
    case 'arrow': {
      const { x1, y1, x2, y2 } = lineEndpoints(svg, w, h)
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.hypot(dx, dy) || 1
      const ux = dx / length
      const uy = dy / length
      const headLen = Math.min(16, length / 3)
      const headHalfWidth = headLen / 2
      const baseX = x2 - ux * headLen
      const baseY = y2 - uy * headLen
      const px = -uy * headHalfWidth
      const py = ux * headHalfWidth
      const line = svg.querySelector('line')
      const head = svg.querySelector('polygon')
      line.setAttribute('x1', x1)
      line.setAttribute('y1', y1)
      line.setAttribute('x2', baseX)
      line.setAttribute('y2', baseY)
      head.setAttribute(
        'points',
        `${x2},${y2} ${baseX + px},${baseY + py} ${baseX - px},${baseY - py}`
      )
      break
    }
  }
}

function lineEndpoints(svg, w, h) {
  const start = svg.getAttribute('data-re-line-start') || 'nw'
  const x1 = start.includes('w') ? 0 : w
  const y1 = start.includes('n') ? 0 : h
  const points = { x1, y1, x2: w - x1, y2: h - y1 }
  // A box a single pixel tall (or wide) is a segment meant to be flat: draw
  // it dead level down the middle rather than with a 1px tilt.
  if (h <= 1) points.y1 = points.y2 = h / 2
  if (w <= 1) points.x1 = points.x2 = w / 2
  return points
}

// Dragging an endpoint free-hand almost never lands exactly flat. Holding
// Shift constrains the segment to 15deg steps (PowerPoint's behavior);
// otherwise a small magnet pulls near-flat segments onto the horizontal or
// vertical, and Ctrl (the editor's usual snap override) turns that off.
export const ANGLE_SNAP_STEP = 15
export const FLAT_SNAP_TOLERANCE = 4

/**
 * Move `moving` onto a constrained angle around `fixed`, keeping the segment
 * length. With `step` the angle snaps to that many degrees; otherwise a
 * segment within `tolerance` degrees of flat is pulled onto the axis. Returns
 * `moving` unchanged when neither applies.
 */
export function constrainSegmentAngle(fixed, moving, { step = 0, tolerance = 0 } = {}) {
  const dx = moving.x - fixed.x
  const dy = moving.y - fixed.y
  const length = Math.hypot(dx, dy)
  if (!length) return { ...moving }
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI
  let snapped
  if (step > 0) {
    snapped = Math.round(degrees / step) * step
  } else if (tolerance > 0) {
    snapped = Math.round(degrees / 90) * 90
    if (Math.abs(degrees - snapped) > tolerance) return { ...moving }
  } else {
    return { ...moving }
  }
  const radians = (snapped * Math.PI) / 180
  return { x: fixed.x + Math.cos(radians) * length, y: fixed.y + Math.sin(radians) * length }
}

export function shapeColors(svg) {
  const kind = svg?.getAttribute('data-shape')
  if (!kind) return null
  const geometry = svg.firstElementChild
  return {
    fill: kind === 'rect' || kind === 'ellipse' ? geometry.getAttribute('fill') || '#dbe9f8' : null,
    stroke: geometry.getAttribute('stroke') || '#2f6fba',
    strokeWidth: readStrokeWidth(geometry)
  }
}

function readStrokeWidth(geometry) {
  const raw = geometry.querySelector?.('[stroke-width]')?.getAttribute('stroke-width') ?? geometry.getAttribute('stroke-width')
  const width = Number(raw)
  return Number.isFinite(width) && raw !== null ? Math.max(0, width) : STROKE_WIDTH
}

export function setShapeColors(svg, { fill, stroke, strokeWidth } = {}) {
  const kind = svg?.getAttribute('data-shape')
  if (!kind) return
  const geometry = svg.firstElementChild
  if (fill != null && (kind === 'rect' || kind === 'ellipse')) geometry.setAttribute('fill', fill)
  if (stroke != null) {
    geometry.setAttribute('stroke', stroke)
    if (kind === 'arrow') geometry.setAttribute('fill', stroke)
  }
  if (strokeWidth != null) {
    const value = String(Math.max(0, Number(strokeWidth)))
    if (kind === 'arrow') geometry.querySelector('line').setAttribute('stroke-width', value)
    else geometry.setAttribute('stroke-width', value)
  }
  syncShapeGeometry(svg)
}
