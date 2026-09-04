import { editor, runtime } from '../stores/editor.svelte.js'
import { deckDownloadName } from './filename.js'

const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

/** A computed background colour, or null when the element paints nothing. */
function opaque(color) {
  return !color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent' ? null : color
}

/**
 * The nodes making up one rendered slide, bottom first. reveal.js paints the
 * slide background in a sibling element outside the `<section>`, so a capture
 * of the section alone has no `data-background-*` colour, image or gradient.
 */
export function slideLayers(section) {
  const background = section.slideBackgroundElement
  return background ? [background, section] : [section]
}

/**
 * The fragment states to capture for a slide, in the order reveal.js uses for
 * its own PDF export: one page with nothing revealed, then one more page per
 * fragment step. A slide without fragments yields a single page in whatever
 * state the deck is already in.
 */
export function fragmentSteps(section) {
  const indices = [...new Set([...section.querySelectorAll('.fragment')].map((fragment) => {
    const index = Number(fragment.getAttribute('data-fragment-index'))
    return Number.isFinite(index) ? index : 0
  }))].sort((a, b) => a - b)
  return indices.length ? [-1, ...indices] : [undefined]
}

async function compositeLayers(images, width, height, doc) {
  if (images.length === 1) return images[0]
  const canvas = doc.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('cannot composite slide backgrounds: no 2D canvas context')
  for (const source of images) {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('a rendered slide layer could not be decoded'))
      image.src = source
    })
    context.drawImage(image, 0, 0, width, height)
  }
  return canvas.toDataURL('image/png')
}

/**
 * Rasterize every slide, one image per fragment step. `imaging` overrides the
 * html-to-image entry points and the layer compositor.
 */
export async function renderSlides(imaging = {}) {
  const loaded = imaging.toPng && imaging.getFontEmbedCSS ? imaging : await import('html-to-image')
  const toPng = imaging.toPng ?? loaded.toPng
  const getFontEmbedCSS = imaging.getFontEmbedCSS ?? loaded.getFontEmbedCSS
  const composite = imaging.composite ?? compositeLayers

  const bridge = runtime.bridge
  const entries = bridge.getSlideEntries()
  const original = bridge.getIndex()
  const { width, height } = bridge.config()
  const canvasWidth = width * 2
  const canvasHeight = height * 2
  // Collecting the @font-face rules is the expensive part of a capture and
  // the result is the same for every slide, so gather them once.
  const fontEmbedCSS = await getFontEmbedCSS(bridge.slidesEl)
  const viewportColor = opaque(getComputedStyle(bridge.doc.querySelector('.reveal-viewport') ?? bridge.slidesEl).backgroundColor)
  const images = []
  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const layers = slideLayers(entry.section)
      for (const fragment of fragmentSteps(entry.section)) {
        editor.statusMessage = `Rendering slide ${i + 1} of ${entries.length}…`
        bridge.goTo(entry.h, entry.v, fragment)
        await nextPaint()
        const rendered = []
        for (const [index, layer] of layers.entries()) {
          rendered.push(await toPng(layer, {
            width,
            height,
            canvasWidth,
            canvasHeight,
            fontEmbedCSS,
            // Only the bottom layer is filled in; the layers above it have to
            // stay transparent so the background shows through.
            backgroundColor: index === 0
              ? (opaque(getComputedStyle(layer).backgroundColor) ?? viewportColor ?? '#fff')
              : undefined,
            style: { display: 'block', position: 'relative', transform: 'none' },
            filter: (node) => !node.matches?.('aside.notes')
          }))
        }
        images.push(await composite(rendered, canvasWidth, canvasHeight, bridge.doc))
      }
    }
  } finally {
    bridge.goTo(original.h, original.v)
  }
  return { images, width, height }
}

export async function exportPresentation(format) {
  if (!runtime.bridge) throw new Error('The deck is not ready yet.')
  if (editor.saving) throw new Error('The deck is being saved; try the export again in a moment.')
  try {
    const { images, width, height } = await renderSlides()
    if (format === 'pdf') {
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: width >= height ? 'landscape' : 'portrait', unit: 'px', format: [width, height], hotfixes: ['px_scaling'] })
      images.forEach((image, index) => {
        if (index) pdf.addPage([width, height], width >= height ? 'landscape' : 'portrait')
        pdf.addImage(image, 'PNG', 0, 0, width, height, undefined, 'FAST')
      })
      pdf.save(`${deckDownloadName()}.pdf`)
    } else {
      const { savePptx } = await import('./pptx.js')
      savePptx(images, width, height, `${deckDownloadName()}.pptx`)
    }
    editor.statusMessage = `Downloaded ${format.toUpperCase()} at ${new Date().toLocaleTimeString()}`
  } catch (err) {
    editor.statusMessage = `${format.toUpperCase()} export failed: ${err.message}`
    throw err
  }
}
