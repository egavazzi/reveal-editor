// Slide compositions for the UiT theme, reproducing the official UiT
// PowerPoint template layouts. Geometry is expressed as fractions of the
// slide, taken from the template's own layout XML (16:9, 12192000x6858000
// EMU), so compositions hold on any canvas size.
//
// Anatomy shared with the PowerPoint original:
//   - title/chapter slides: colored field + slanted "image frame" panel on
//     the right + white footer band carrying the full UiT wordmark
//   - content slides: solid background in one of five brand colors with a
//     small round emblem bottom-right (the theme adds that emblem to every
//     slide; slides that bring their own footer opt out via .uit-own-footer)
//   - closing slides: centered emblem, motto bottom-left, uit.no bottom-right
//     (the "Björn’s special" version is the dark closing slide with an animated emblem)
import {
  UIT_EMBLEM_VIEWBOX, UIT_EMBLEM_INNER, UIT_EMBLEM_PETROL_INNER,
  UIT_WORDMARK_VIEWBOX, UIT_WORDMARK_INNER
} from './theme-uit-assets.js'

export const UIT_COLORS = Object.freeze({
  petrol: '#003349',
  ice: '#CDEBEF',
  teal: '#59BEC9',
  yellow: '#FCEECC',
  red: '#F7E0E2',
  white: '#FFFFFF'
})

export const UIT_LAYOUTS = Object.freeze([
  { id: 'uit-title', label: 'UiT — Title (light)' },
  { id: 'uit-title-dark', label: 'UiT — Title (dark)' },
  { id: 'uit-chapter', label: 'UiT — Chapter (light)' },
  { id: 'uit-chapter-dark', label: 'UiT — Chapter (dark)' },
  { id: 'uit-content-white', label: 'UiT — Content (white)' },
  { id: 'uit-content-ice', label: 'UiT — Content (ice blue)' },
  { id: 'uit-content-yellow', label: 'UiT — Content (yellow)' },
  { id: 'uit-content-red', label: 'UiT — Content (red)' },
  { id: 'uit-content-dark', label: 'UiT — Content (dark blue)' },
  { id: 'uit-closing', label: 'UiT — Closing (dark)' },
  { id: 'uit-closing-light', label: 'UiT — Closing (light)' },
  { id: 'uit-closing-bjorn', label: 'UiT — Closing (Björn’s special)' }
])

// Class on the emblem of the "Björn’s special" closing slide; the theme CSS animates it
// (zoom in over 12 s, then spin from 1 min) while the slide is presented.
export const UIT_EMBLEM_ANIMATED_CLASS = 'uit-emblem-zoom-spin'

const SVG_NS = 'http://www.w3.org/2000/svg'

// Template layout geometry, as fractions of the slide (from the potx XML).
const FRAME_TOP_X = 0.760 // slanted panel's left edge at the top…
const FRAME_BOTTOM_X = 0.576 // …and at the bottom of the colored field
const BAND_TOP = 0.884 // white footer band starts here
const WORDMARK = { x: 0.021, y: 0.912, w: 0.330 }

function svgEl(doc, { viewBox, inner, label, x, y, w, h, preserve, className }) {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', className ? `re-el ${className}` : 're-el')
  svg.setAttribute('viewBox', viewBox)
  if (preserve) svg.setAttribute('preserveAspectRatio', preserve)
  if (label) svg.setAttribute('aria-label', label)
  Object.assign(svg.style, {
    position: 'absolute',
    left: `${Math.round(x)}px`,
    top: `${Math.round(y)}px`,
    width: `${Math.round(w)}px`,
    height: `${Math.round(h)}px`,
    overflow: 'hidden'
  })
  svg.innerHTML = inner
  return svg
}

/**
 * The template's slanted image-frame panel: hugs the right edge of the
 * colored field, left edge slanting from FRAME_TOP_X down to FRAME_BOTTOM_X.
 */
function framePanel(doc, W, H, fill) {
  const x = FRAME_BOTTOM_X * W
  const w = (1 - FRAME_BOTTOM_X) * W
  const h = BAND_TOP * H
  const slant = (FRAME_TOP_X - FRAME_BOTTOM_X) * W
  return svgEl(doc, {
    viewBox: `0 0 ${Math.round(w)} ${Math.round(h)}`,
    inner: `<polygon points="${Math.round(slant)} 0 ${Math.round(w)} 0 ${Math.round(w)} ${Math.round(h)} 0 ${Math.round(h)}" fill="${fill}"/>`,
    preserve: 'none',
    label: 'Image frame panel',
    x, y: 0, w, h
  })
}

/**
 * The colored field left of the frame, as a locked element (not just the
 * slide background): an image dropped into the frame slides BEHIND it and
 * is cropped along the diagonal, like the template's picture placeholders.
 */
function fieldPanel(doc, W, H, fill) {
  const w = FRAME_TOP_X * W
  const h = BAND_TOP * H
  const notch = (FRAME_TOP_X - FRAME_BOTTOM_X) * W
  const field = svgEl(doc, {
    viewBox: `0 0 ${Math.round(w)} ${Math.round(h)}`,
    inner: `<polygon points="0 0 ${Math.round(w)} 0 ${Math.round(w - notch)} ${Math.round(h)} 0 ${Math.round(h)}" fill="${fill}"/>`,
    preserve: 'none',
    label: 'Background field',
    x: 0, y: 0, w, h
  })
  // locked so clicks land on the content above; unlock via the Layers panel
  field.setAttribute('data-re-locked', '')
  return field
}

/** Editor-only hint frame: select it, then add/paste/drop an image. */
function imagePlaceholder(doc, W, H, dark) {
  const el = doc.createElement('div')
  el.className = 're-el re-image-placeholder re-transient'
  el.setAttribute('aria-label', 'Image placeholder')
  el.setAttribute('data-re-fit', 'cover')
  const ink = dark ? 'rgba(0,51,73,.75)' : 'rgba(205,235,239,.85)'
  Object.assign(el.style, {
    position: 'absolute',
    left: `${Math.round(FRAME_BOTTOM_X * W)}px`,
    top: '0px',
    width: `${Math.round((1 - FRAME_BOTTOM_X) * W)}px`,
    height: `${Math.round(BAND_TOP * H)}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    boxSizing: 'border-box',
    padding: `0 0 0 ${Math.round((FRAME_TOP_X - FRAME_BOTTOM_X) * W)}px`,
    border: `3px dashed ${ink}`,
    color: ink,
    fontSize: `${Math.round(0.03 * H)}px`
  })
  el.textContent = 'Optional image: select this frame, then add, paste, or drop one'
  return el
}

/** White footer band + full UiT wordmark, as on title/chapter slides. */
function footerBand(doc, W, H) {
  const band = doc.createElement('div')
  band.className = 're-el'
  band.setAttribute('aria-label', 'Footer band')
  Object.assign(band.style, {
    position: 'absolute',
    left: '0px',
    top: `${Math.round(BAND_TOP * H)}px`,
    width: `${Math.round(W)}px`,
    height: `${Math.round((1 - BAND_TOP) * H)}px`,
    background: UIT_COLORS.white
  })
  const w = WORDMARK.w * W
  const wordmark = svgEl(doc, {
    viewBox: UIT_WORDMARK_VIEWBOX,
    inner: UIT_WORDMARK_INNER,
    label: 'UiT wordmark',
    x: WORDMARK.x * W, y: WORDMARK.y * H, w, h: w / 10 // wordmark is ~10:1
  })
  return [band, wordmark]
}

function textEl(doc, tag, { text, x, y, w, size, color, bold, align }) {
  const el = doc.createElement(tag)
  el.className = 're-el'
  el.textContent = text
  Object.assign(el.style, {
    position: 'absolute',
    left: `${Math.round(x)}px`,
    top: `${Math.round(y)}px`,
    width: `${Math.round(w)}px`,
    fontSize: `${Math.round(size)}px`,
    textAlign: align || 'left',
    ...(color ? { color } : {}),
    ...(bold ? { fontWeight: '800' } : {})
  })
  return el
}

const CONTENT_BG = {
  'uit-content-white': UIT_COLORS.white,
  'uit-content-ice': UIT_COLORS.ice,
  'uit-content-yellow': UIT_COLORS.yellow,
  'uit-content-red': UIT_COLORS.red,
  'uit-content-dark': UIT_COLORS.petrol
}

/**
 * Build the elements for a UiT layout id. Fractional template geometry is
 * projected onto the deck canvas (W x H); font sizes scale with H (40pt
 * title = 53px on the template's 720px-high canvas).
 */
export function buildUitLayout(section, layout, _box, { sx = 1, sy = 1 } = {}) {
  const doc = section.ownerDocument
  const W = 960 * sx
  const H = 700 * sy
  const fs = (pt) => (pt * 4 / 3) * (H / 720) // template pt → canvas px
  const elements = []

  if (layout.startsWith('uit-title') || layout.startsWith('uit-chapter')) {
    const dark = layout.endsWith('-dark')
    const title = layout.startsWith('uit-title')
    section.setAttribute('data-background-color', dark ? UIT_COLORS.petrol : UIT_COLORS.ice)
    section.classList.add('uit-own-footer')
    // stacking, back to front: frame color → (image lands here) → field
    elements.push(
      framePanel(doc, W, H, dark ? UIT_COLORS.ice : UIT_COLORS.petrol),
      imagePlaceholder(doc, W, H, dark),
      fieldPanel(doc, W, H, dark ? UIT_COLORS.petrol : UIT_COLORS.ice)
    )
    elements.push(textEl(doc, title ? 'h1' : 'h2', {
      text: title ? 'Presentation title' : 'Chapter title',
      x: 0.062 * W, y: 0.156 * H, w: 0.493 * W, size: fs(40)
    }))
    if (title) {
      elements.push(
        textEl(doc, 'p', { text: 'An explanatory subtitle', x: 0.062 * W, y: 0.422 * H,
          w: 0.493 * W, size: fs(24), color: dark ? UIT_COLORS.ice : undefined }),
        textEl(doc, 'p', { text: 'Name Surname · Faculty or department · Date',
          x: 0.062 * W, y: 0.800 * H, w: 0.493 * W, size: fs(15),
          color: dark ? UIT_COLORS.ice : undefined })
      )
    }
    elements.push(...footerBand(doc, W, H))
  } else if (layout in CONTENT_BG) {
    const bg = CONTENT_BG[layout]
    const dark = bg === UIT_COLORS.petrol
    section.setAttribute('data-background-color', bg)
    elements.push(
      textEl(doc, 'h2', { text: 'Slide title', x: 0.069 * W, y: 0.053 * H,
        w: 0.827 * W, size: fs(40) }),
      textEl(doc, 'div', { text: 'Add your content here', x: 0.069 * W, y: 0.266 * H,
        w: 0.827 * W, size: fs(24), color: dark ? '#ffffff' : undefined })
    )
    elements.at(-1).className = 're-el re-text'
    elements.at(-1).style.height = `${Math.round(0.634 * H)}px`
  } else if (layout.startsWith('uit-closing')) {
    const dark = layout !== 'uit-closing-light'
    const animated = layout === 'uit-closing-bjorn'
    section.setAttribute('data-background-color', dark ? UIT_COLORS.petrol : UIT_COLORS.ice)
    section.classList.add('uit-own-footer')
    const size = 0.185 * W
    elements.push(
      svgEl(doc, {
        viewBox: UIT_EMBLEM_VIEWBOX,
        inner: dark ? UIT_EMBLEM_INNER : UIT_EMBLEM_PETROL_INNER,
        label: 'UiT emblem',
        x: 0.408 * W, y: 0.275 * H, w: size, h: size,
        className: animated ? UIT_EMBLEM_ANIMATED_CLASS : undefined
      }),
      textEl(doc, 'p', { text: 'Drivkraft i nord', x: 0.030 * W, y: 0.918 * H,
        w: 0.352 * W, size: fs(15), bold: true,
        color: dark ? UIT_COLORS.ice : UIT_COLORS.petrol }),
      textEl(doc, 'p', { text: 'uit.no', x: 0.800 * W, y: 0.918 * H,
        w: 0.170 * W, size: fs(15), bold: true, align: 'right',
        color: dark ? UIT_COLORS.ice : UIT_COLORS.petrol })
    )
  }

  return elements
}
