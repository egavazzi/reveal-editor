import { cleanSlides } from './clean.js'
import { putDeck } from '../api.js'
import { editor, runtime } from '../../stores/editor.svelte.js'

export async function saveDeck() {
  if (!runtime.bridge || editor.saving) return
  editor.saving = true
  try {
    const slidesHtml = cleanSlides(runtime.bridge.slidesEl)
    const { mtimeMs } = await putDeck(slidesHtml, editor.mtimeMs)
    editor.mtimeMs = mtimeMs
    editor.dirty = false
    editor.statusMessage = `Saved at ${new Date().toLocaleTimeString()}`
  } catch (err) {
    if (err.status === 409) {
      editor.statusMessage = 'Deck was changed on disk by another program — reload to pick up changes before saving.'
    } else {
      editor.statusMessage = `Save failed: ${err.message}`
    }
  } finally {
    editor.saving = false
  }
}
