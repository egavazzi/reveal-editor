import { UIT_LAYOUTS, buildUitLayout } from './theme-uit.js'

export const SLIDE_LAYOUTS = Object.freeze([
  { id: 'blank', label: 'Blank' },
  { id: 'title', label: 'Title slide' },
  { id: 'title-body', label: 'Title + body' },
  { id: 'two-column', label: 'Two columns' },
  { id: 'image-focus', label: 'Image focus' }
])

const THEME_LAYOUTS = { uit: UIT_LAYOUTS }

/** Layouts offered for a deck: the built-in set plus the theme's own. */
export function slideLayoutsFor(settings) {
  const themed = THEME_LAYOUTS[settings?.theme]
  return themed ? [...SLIDE_LAYOUTS, ...themed] : SLIDE_LAYOUTS
}

function positioned(doc, tag, { text, className = '', left, top, width, height, styles = {} }) {
  const el = doc.createElement(tag)
  el.className = `re-el ${className}`.trim()
  el.textContent = text
  Object.assign(el.style, {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    ...(height ? { height: `${height}px` } : {}),
    ...styles
  })
  return el
}

/** Populate an empty section with editor-native, readable HTML elements. */
export function applyLayout(section, layout, settings = {}) {
  const { width = 960, height = 700 } = settings
  if (!section || !slideLayoutsFor(settings).some((item) => item.id === layout)) return []
  const doc = section.ownerDocument
  const sx = width / 960
  const sy = height / 700
  const box = (tag, options) => positioned(doc, tag, {
    ...options,
    left: Math.round(options.left * sx),
    top: Math.round(options.top * sy),
    width: Math.round(options.width * sx),
    height: options.height ? Math.round(options.height * sy) : undefined
  })

  if (layout.startsWith('uit-')) {
    const elements = buildUitLayout(section, layout, box, { sx, sy })
    section.append(...elements)
    return elements
  }

  const elements = []

  if (layout === 'title') {
    elements.push(
      box('h1', { text: 'Presentation title', left: 80, top: 230, width: 800,
        styles: { textAlign: 'center', fontSize: '68px' } }),
      box('p', { text: 'Author · Date', left: 100, top: 390, width: 760,
        styles: { textAlign: 'center', fontSize: '28px' } })
    )
  } else if (layout === 'title-body') {
    elements.push(
      box('h2', { text: 'Slide title', left: 64, top: 48, width: 832,
        styles: { fontSize: '52px' } }),
      box('div', { text: 'Add your main point here', className: 're-text', left: 64, top: 170,
        width: 832, height: 420, styles: { fontSize: '30px' } })
    )
  } else if (layout === 'two-column') {
    elements.push(
      box('h2', { text: 'Slide title', left: 64, top: 48, width: 832,
        styles: { fontSize: '52px' } }),
      box('div', { text: 'Left column', className: 're-text', left: 64, top: 170,
        width: 384, height: 420, styles: { fontSize: '28px' } }),
      box('div', { text: 'Right column', className: 're-text', left: 512, top: 170,
        width: 384, height: 420, styles: { fontSize: '28px' } })
    )
  } else if (layout === 'image-focus') {
    const placeholder = box('div', {
      text: 'Select this frame, then add, paste, or drop an image',
      className: 're-image-placeholder re-transient',
      left: 100,
      top: 150,
      width: 760,
      height: 430,
      styles: {
        alignItems: 'center',
        border: '3px dashed rgba(127,127,127,.65)',
        boxSizing: 'border-box',
        color: '#777',
        display: 'flex',
        fontSize: '22px',
        justifyContent: 'center',
        textAlign: 'center'
      }
    })
    placeholder.setAttribute('aria-label', 'Image placeholder')
    elements.push(
      box('h2', { text: 'Slide title', left: 64, top: 40, width: 832,
        styles: { fontSize: '48px', textAlign: 'center' } }),
      placeholder,
      box('p', { text: 'Optional caption', left: 100, top: 610, width: 760,
        styles: { fontSize: '22px', textAlign: 'center' } })
    )
  }

  section.append(...elements)
  return elements
}

export function isSlideEmpty(section) {
  return ![...section.children].some((el) =>
    !el.matches('aside.notes, .re-transient')
  )
}

