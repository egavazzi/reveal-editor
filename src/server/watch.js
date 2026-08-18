import chokidar from 'chokidar'
import { ownWrites } from './deck.js'

const watchers = new Map()

/**
 * Subscribe to external changes of the deck file. Changes caused by our own
 * saves (recorded in ownWrites) are ignored. Returns an unsubscribe function.
 */
export function watchDeck(deckPath, onEvent) {
  let entry = watchers.get(deckPath)
  if (!entry) {
    entry = { subscribers: new Set(), watcher: null }
    entry.watcher = chokidar
      .watch(deckPath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200 } })
      .on('change', () => {
        const own = ownWrites.get(deckPath)
        if (own && Date.now() - own < 1000) return
        for (const cb of entry.subscribers) cb({ type: 'deck-changed' })
      })
    watchers.set(deckPath, entry)
  }
  entry.subscribers.add(onEvent)
  return () => {
    entry.subscribers.delete(onEvent)
    if (entry.subscribers.size === 0) {
      watchers.delete(deckPath)
      void entry.watcher.close()
    }
  }
}
