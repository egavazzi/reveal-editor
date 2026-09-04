import { editor, runtime } from '../stores/editor.svelte.js'

const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

async function renderSlides() {
  const { toPng } = await import('html-to-image')
  const bridge = runtime.bridge
  const entries = bridge.getSlideEntries()
  const original = bridge.getIndex()
  const { width, height } = bridge.config()
  const images = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    editor.statusMessage = `Rendering slide ${i + 1} of ${entries.length}…`
    bridge.goTo(entry.h, entry.v)
    await nextPaint()
    const background = getComputedStyle(entry.section).backgroundColor ||
      getComputedStyle(bridge.doc.querySelector('.reveal-viewport')).backgroundColor || '#fff'
    images.push(await toPng(entry.section, {
      width, height,
      canvasWidth: width * 2,
      canvasHeight: height * 2,
      skipFonts: true,
      backgroundColor: background === 'rgba(0, 0, 0, 0)' ? '#fff' : background,
      style: { display: 'block', position: 'relative', transform: 'none' },
      filter: (node) => !node.matches?.('aside.notes')
    }))
  }
  bridge.goTo(original.h, original.v)
  return { images, width, height }
}

function safeName() {
  return (editor.deckFile || 'presentation').replace(/\.html?$/i, '').replace(/[^a-z0-9._-]+/gi, '-')
}

export async function exportPresentation(format) {
  if (!runtime.bridge || editor.saving) return
  try {
    const { images, width, height } = await renderSlides()
    if (format === 'pdf') {
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: width >= height ? 'landscape' : 'portrait', unit: 'px', format: [width, height], hotfixes: ['px_scaling'] })
      images.forEach((image, index) => {
        if (index) pdf.addPage([width, height], width >= height ? 'landscape' : 'portrait')
        pdf.addImage(image, 'PNG', 0, 0, width, height, undefined, 'FAST')
      })
      pdf.save(`${safeName()}.pdf`)
    } else {
      const { savePptx } = await import('./pptx.js')
      savePptx(images, width, height, `${safeName()}.pptx`)
    }
    editor.statusMessage = `Downloaded ${format.toUpperCase()} at ${new Date().toLocaleTimeString()}`
  } catch (err) {
    editor.statusMessage = `${format.toUpperCase()} export failed: ${err.message}`
  }
}
