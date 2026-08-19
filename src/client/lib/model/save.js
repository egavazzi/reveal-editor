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
      // The file changed under us (another editor tab, an external write).
      // Blocking forever would strand the user's edits — offer an explicit
      // overwrite, which saves without the mtime precondition.
      if (window.confirm(
        'The deck file was changed on disk (another editor tab or program) since this view loaded.\n\n' +
        'Overwrite it with THIS view’s version? The other version will be lost.\n' +
        'Choose Cancel to keep the disk version — then reload this page and redo your edits.'
      )) {
        try {
          const slidesHtml = cleanSlides(runtime.bridge.slidesEl)
          const { mtimeMs } = await putDeck(slidesHtml, null)
          editor.mtimeMs = mtimeMs
          editor.dirty = false
          editor.statusMessage = `Saved (overwrote disk version) at ${new Date().toLocaleTimeString()}`
        } catch (err2) {
          editor.statusMessage = `Save failed: ${err2.message}`
        }
      } else {
        editor.statusMessage = 'Not saved — reload the page to pick up the disk version before editing further.'
      }
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
