// How large each of the deck's media files has to be in a self-contained
// export. A picture only needs the pixels the projector can show: twice the
// size the element is drawn at in slide coordinates covers a retina display
// and any zoom the presenter applies, and everything beyond that is bytes the
// audience never sees.
//
// A file used in several places gets the size of its largest use, and one
// whose size cannot be measured is left at its own size — the export never
// enlarges a file, and never guesses smaller.
import { assetReferences } from './asset-refs.js'

// Attributes that fill a whole slide rather than an element box.
const BACKGROUND_ATTRS = ['data-background-image', 'data-background-video', 'data-background']

export const EXPORT_OVERSAMPLE = 2

/**
 * The size `element` is drawn at in slide coordinates, or null when it has
 * no measurable box. The editor writes positioned elements with an inline
 * width/height in slide pixels; anything else is measured live and divided
 * by the scale reveal.js applies to the whole canvas.
 *
 * For a cropped picture this is the picture's own box — the `<img>` inside
 * the `.re-image-frame` carries the scaled size of the whole image, of which
 * the frame shows a part — so a crop keeps the resolution it is displayed
 * at, not the resolution of the visible slice.
 */
export function displayedSize(element, scale = 1) {
  const width = parseFloat(element?.style?.width)
  const height = parseFloat(element?.style?.height)
  if (width > 0 && height > 0) return { width, height }
  const rect = element?.getBoundingClientRect?.()
  if (rect && rect.width > 0 && rect.height > 0 && scale > 0) {
    return { width: rect.width / scale, height: rect.height / scale }
  }
  return null
}

/** The element whose box decides the size of a reference on `element`. */
function boxElement(element) {
  // a <source> has no box of its own; its <video> or <picture> parent does
  return element.tagName === 'SOURCE' ? element.parentElement ?? element : element
}

/**
 * The size every media file referenced under `slidesEl` has to be embedded
 * at, as `[{ path, refs, target }]`. `refs` are the references as written
 * (so a caller can resolve them against the deck's base URL) and `target` is
 * `{ width, height }`, or null for a file that must keep its own size.
 *
 * `scale` is the factor reveal.js applies to the slide canvas;
 * `slideWidth`/`slideHeight` are the deck's configured slide size, which is
 * what a slide background covers.
 */
export function mediaPlan({
  slidesEl, scale = 1, slideWidth = 960, slideHeight = 700, oversample = EXPORT_OVERSAMPLE
}) {
  const byPath = new Map()
  for (const ref of assetReferences(slidesEl)) {
    const size = BACKGROUND_ATTRS.includes(ref.attribute)
      ? { width: slideWidth, height: slideHeight }
      : displayedSize(boxElement(ref.element), scale)
    const entry = byPath.get(ref.path) ?? { path: ref.path, refs: [], largest: null, unmeasured: false }
    if (!entry.refs.includes(ref.raw)) entry.refs.push(ref.raw)
    if (!size) entry.unmeasured = true
    else if (!entry.largest || size.width * size.height > entry.largest.width * entry.largest.height) {
      entry.largest = size
    }
    byPath.set(ref.path, entry)
  }
  return [...byPath.values()].map(({ path, refs, largest, unmeasured }) => ({
    path,
    refs,
    // one use whose box cannot be measured keeps the file at its own size
    target: unmeasured || !largest
      ? null
      : { width: Math.ceil(largest.width * oversample), height: Math.ceil(largest.height * oversample) }
  }))
}
