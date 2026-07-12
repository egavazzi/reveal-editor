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
  line: { width: 300, height: 10 },
  arrow: { width: 300, height: 24 }
}

export function createShape(doc, kind) {
  const { width, height } = SHAPE_DEFAULTS[kind]
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 're-el')
  svg.setAttribute('data-shape', kind)
  svg.style.width = `${width}px`
  svg.style.height = `${height}px`
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
  const inset = STROKE_WIDTH / 2
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.setAttribute('width', w)
  svg.setAttribute('height', h)

  switch (kind) {
    case 'rect': {
      const rect = svg.querySelector('rect')
      rect.setAttribute('x', inset)
      rect.setAttribute('y', inset)
      rect.setAttribute('width', Math.max(1, w - STROKE_WIDTH))
      rect.setAttribute('height', Math.max(1, h - STROKE_WIDTH))
      break
    }
    case 'ellipse': {
      const el = svg.querySelector('ellipse')
      el.setAttribute('cx', w / 2)
      el.setAttribute('cy', h / 2)
      el.setAttribute('rx', Math.max(1, (w - STROKE_WIDTH) / 2))
      el.setAttribute('ry', Math.max(1, (h - STROKE_WIDTH) / 2))
      break
    }
    case 'line': {
      const el = svg.querySelector('line')
      el.setAttribute('x1', 0)
      el.setAttribute('y1', h / 2)
      el.setAttribute('x2', w)
      el.setAttribute('y2', h / 2)
      break
    }
    case 'arrow': {
      const headLen = Math.min(16, w / 3)
      const line = svg.querySelector('line')
      const head = svg.querySelector('polygon')
      line.setAttribute('x1', 0)
      line.setAttribute('y1', h / 2)
      line.setAttribute('x2', w - headLen)
      line.setAttribute('y2', h / 2)
      head.setAttribute(
        'points',
        `${w},${h / 2} ${w - headLen},${Math.max(0, h / 2 - headLen / 2)} ${w - headLen},${h / 2 + headLen / 2}`
      )
      break
    }
  }
}
