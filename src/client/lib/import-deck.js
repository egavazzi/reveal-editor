// Replace the open deck's slides with an imported presentation.
//
// Only the `.slides` subtree of the imported document is kept: the deck's
// own head, reveal.js runtime and vendored assets stay as they are, so an
// import never has to be trusted to bring a working presentation shell.
import { fetchDeck } from './api.js'
import { readDeckZip } from './import.js'
import { markDirty, snapshotDeck } from './actions.js'
import { initializeSettings } from './model/settings.js'
import { rehydrate } from './model/rehydrate.js'
import { editor, runtime } from '../stores/editor.svelte.js'

// Attribute values the deck must never carry: the deck iframe is
// same-origin with the editor, so imported markup runs with the editor's
// privileges.
const DANGEROUS_URL = /^\s*(?:javascript:|vbscript:|data:text\/html)/i

function sanitize(slides) {
  for (const script of slides.querySelectorAll('script')) script.remove()
  for (const frame of slides.querySelectorAll('iframe')) frame.removeAttribute('srcdoc')
  for (const element of slides.querySelectorAll('*')) {
    for (const { name, value } of [...element.attributes]) {
      if (name.toLowerCase().startsWith('on') || DANGEROUS_URL.test(value)) {
        element.removeAttribute(name)
      }
    }
  }
}

/**
 * The importable `.slides` markup of a presentation document, with scripts
 * and event handlers removed. Whoever produced `html` is responsible for
 * having embedded every asset reference it makes.
 */
export function importableSlides(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const slides = doc.querySelector('.reveal .slides')
  if (!slides) throw new Error('The presentation has no reveal.js slides element.')
  if (!slides.querySelector(':scope > section')) throw new Error('The presentation has no slides.')
  sanitize(slides)
  return slides.innerHTML
}

/**
 * Read a reveal.js ZIP or a Keynote file and put its slides into the open
 * deck as one undoable edit. The deck is left dirty; saving writes it out.
 * Resolves to a description of what was imported.
 */
export async function importPresentation(file) {
  const bridge = runtime.bridge
  if (!bridge) throw new Error('The deck is not ready yet.')
  let warnings = []
  let html
  if (/\.key$/i.test(file.name)) {
    editor.statusMessage = 'Reading Keynote presentation…'
    // The open deck doubles as the template: its head carries the reveal.js
    // runtime and theme this editor already knows how to drive.
    const { readKeynote } = await import('./keynote.js')
    const converted = await readKeynote(file, (await fetchDeck()).html, { inlineAssets: true })
    html = converted.html
    warnings = converted.warnings ?? []
  } else {
    editor.statusMessage = 'Reading presentation archive…'
    html = await readDeckZip(file)
  }
  const slidesHtml = importableSlides(html)

  snapshotDeck()
  bridge.slidesEl.innerHTML = slidesHtml
  rehydrate(bridge, bridge.slidesEl)
  initializeSettings(bridge, editor.settings)
  bridge.sync()
  bridge.goTo(0)
  runtime.overlay.setSelection([])
  editor.slideCount = bridge.getSlideEntries().length
  editor.slideIndex = bridge.getIndex()
  markDirty()
  return { slideCount: editor.slideCount, warnings }
}
