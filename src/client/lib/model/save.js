import { cleanSlides } from './clean.js'
import { putDeck } from '../api.js'
import { editor, runtime } from '../../stores/editor.svelte.js'

let saveQueued = false
let inflight = null

/**
 * Resolves once the edits present at call time are on disk — or once the save
 * has failed, in which case the deck is still dirty and the status bar carries
 * the error. A call made while a save is in flight waits for that save and
 * for the follow-up that picks up any newer edits, so `editor.dirty` is
 * trustworthy as soon as the returned promise settles.
 */
export function saveDeck() {
  if (!runtime.bridge) return Promise.resolve()
  if (!editor.dirty && !editor.saving) {
    editor.statusMessage = 'No changes to save.'
    return Promise.resolve()
  }
  if (editor.saving) {
    saveQueued = true
    return inflight ?? Promise.resolve()
  }
  inflight = performSave().finally(() => {
    inflight = null
    editor.saving = false
    if (saveQueued) {
      saveQueued = false
      // returning the promise makes earlier callers wait for this save too
      if (editor.dirty) return saveDeck()
    }
  })
  return inflight
}

async function performSave() {
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
  }
}
