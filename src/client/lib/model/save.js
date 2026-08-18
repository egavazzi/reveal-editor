import { cleanSlides } from './clean.js'
import { putDeck } from '../api.js'
import { editor, runtime } from '../../stores/editor.svelte.js'

let saveQueued = false

export async function saveDeck() {
  if (!runtime.bridge) return
  if (!editor.dirty && !editor.saving) {
    editor.statusMessage = 'No changes to save.'
    return
  }
  if (editor.saving) {
    saveQueued = true
    return
  }
  editor.saving = true
  const savedVersion = editor.docVersion
  try {
    const slidesHtml = cleanSlides(runtime.bridge.slidesEl)
    const { mtimeMs } = await putDeck(slidesHtml, editor.mtimeMs)
    editor.mtimeMs = mtimeMs
    if (editor.docVersion === savedVersion) {
      editor.dirty = false
      editor.statusMessage = `Saved at ${new Date().toLocaleTimeString()}`
    } else {
      editor.dirty = true
      saveQueued = true
      editor.statusMessage = 'Saving newer edits…'
    }
  } catch (err) {
    if (err.status === 409) {
      editor.statusMessage = 'Deck was changed on disk by another program — reload to pick up changes before saving.'
    } else {
      editor.statusMessage = `Save failed: ${err.message}`
    }
  } finally {
    editor.saving = false
    if (saveQueued && editor.dirty) {
      saveQueued = false
      void saveDeck()
    } else {
      saveQueued = false
    }
  }
}
