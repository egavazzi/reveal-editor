import { editor } from '../stores/editor.svelte.js'

/**
 * The open deck's file name without its extension, reduced to characters that
 * are safe in a download attribute on every platform.
 */
export function deckDownloadName() {
  return (editor.deckFile || 'presentation')
    .replace(/\.html?$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
}
