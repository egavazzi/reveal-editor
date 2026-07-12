// Positioning conventions: an editable element on the canvas carries
// class "re-el" plus a self-sufficient inline style
// (position:absolute; left/top in canvas px). Elements in foreign decks
// are converted lazily, the first time the user drags them.
import { getCanvasSize } from '../overlay/editmode.js'

export function isPositioned(el) {
  return el.style.position === 'absolute' || el.style.position === 'fixed'
}

/**
 * Convert an element to absolute canvas positioning, preserving its current
 * visual position exactly. No-op if already positioned.
 */
export function ensurePositioned(el, bridge) {
  if (isPositioned(el)) return
  const section = el.closest('section')
  if (!section) return
  const { width } = getCanvasSize(bridge)
  const sectionRect = section.getBoundingClientRect()
  const scale = sectionRect.width / width || 1
  const rect = el.getBoundingClientRect()

  el.style.position = 'absolute'
  el.style.left = `${Math.round((rect.left - sectionRect.left) / scale)}px`
  el.style.top = `${Math.round((rect.top - sectionRect.top) / scale)}px`
  el.style.width = `${Math.round(rect.width / scale)}px`
  // margins participated in static layout; they must not offset the
  // absolute position
  el.style.margin = '0'
  el.classList.add('re-el')
}

/** Round the editor-written geometry styles to whole canvas pixels. */
export function roundGeometry(el) {
  for (const prop of ['left', 'top', 'width', 'height']) {
    const v = el.style[prop]
    if (v && v.endsWith('px')) {
      el.style[prop] = `${Math.round(parseFloat(v))}px`
    }
  }
  const rotate = el.style.transform.match(/rotate\((-?[\d.]+)deg\)/)
  if (rotate) {
    const deg = Math.round(parseFloat(rotate[1]) * 10) / 10
    el.style.transform = deg === 0 ? '' : `rotate(${deg}deg)`
    if (!el.style.transform) el.style.removeProperty('transform')
  }
}
