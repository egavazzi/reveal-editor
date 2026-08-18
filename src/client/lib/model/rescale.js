// Proportionally rescale positioned slide content when the canvas size
// changes. Horizontal lengths scale by the width ratio, vertical lengths by
// the height ratio, and font sizes by the height ratio so text keeps the
// same size relative to the slide (reveal fits the canvas to the screen, so
// relative-to-height is what the audience perceives).
import { syncShapeGeometry } from './shapes.js'

export function rescaleSlides(slidesEl, from, to) {
  const sx = to.width / from.width
  const sy = to.height / from.height
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return false
  if (sx === 1 && sy === 1) return false
  for (const section of slidesEl.querySelectorAll(':scope > section')) {
    for (const el of [section, ...section.querySelectorAll('*')]) {
      if (el.tagName === 'SECTION' || el.closest('aside.notes')) continue
      rescaleElement(el, sx, sy)
    }
  }
  return true
}

function rescaleElement(el, sx, sy) {
  const style = el.style
  if (!style || style.position !== 'absolute') return
  scaleLength(style, 'left', sx)
  scaleLength(style, 'width', sx)
  scaleLength(style, 'top', sy)
  scaleLength(style, 'height', sy)
  scaleLength(style, 'fontSize', sy)
  if (el.hasAttribute?.('data-shape')) syncShapeGeometry(el)
}

function scaleLength(style, prop, factor) {
  const value = style[prop]
  if (!value || !value.endsWith('px')) return
  const number = parseFloat(value)
  if (!Number.isFinite(number)) return
  style[prop] = `${Math.round(number * factor)}px`
}
