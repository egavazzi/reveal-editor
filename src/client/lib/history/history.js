// Snapshot-based undo/redo. The DOM is the document model, so history
// entries are cleaned HTML snapshots — per-slide for element edits,
// whole-deck for structural operations. Restores rehydrate plugins and
// editor bookkeeping.
import { cleanSlides, cleanElementHtml } from '../model/clean.js'
import { rehydrate } from '../model/rehydrate.js'

const LIMIT = 100

const past = []
const future = []

function capture(bridge, scope) {
  if (scope.type === 'deck') {
    return { scope, html: cleanSlides(bridge.slidesEl) }
  }
  const section = bridge.getSections()[scope.h]
  return { scope, html: cleanElementHtml(section) }
}

function restore(bridge, entry) {
  if (entry.scope.type === 'deck') {
    bridge.slidesEl.innerHTML = entry.html
    rehydrate(bridge, bridge.slidesEl)
    bridge.sync()
    bridge.goTo(Math.min(entry.scope.h ?? 0, bridge.getSections().length - 1))
  } else {
    const section = bridge.getSections()[entry.scope.h]
    if (!section) return
    const tmp = bridge.doc.createElement('div')
    tmp.innerHTML = entry.html
    const fresh = tmp.firstElementChild
    section.replaceWith(fresh)
    rehydrate(bridge, fresh)
    bridge.sync()
    bridge.goTo(entry.scope.h)
  }
}

/** Record state BEFORE a mutation. scope: {type:'slide',h} | {type:'deck',h} */
export function snapshot(bridge, scope) {
  past.push(capture(bridge, scope))
  if (past.length > LIMIT) past.shift()
  future.length = 0
}

export function undo(bridge) {
  const entry = past.pop()
  if (!entry) return false
  future.push(capture(bridge, entry.scope))
  restore(bridge, entry)
  return true
}

export function redo(bridge) {
  const entry = future.pop()
  if (!entry) return false
  past.push(capture(bridge, entry.scope))
  restore(bridge, entry)
  return true
}

export function historySizes() {
  return { undo: past.length, redo: future.length }
}
