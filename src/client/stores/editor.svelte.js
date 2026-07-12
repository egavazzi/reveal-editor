// Central UI state. Note: slide CONTENT never lives here — the DOM inside
// the iframe is the single source of truth. This store only holds selection
// and editor chrome state.
export const editor = $state({
  deckFile: null,
  mtimeMs: null,
  ready: false,
  error: null,
  mode: 'edit', // 'edit' | 'preview'
  slideIndex: { h: 0, v: 0 },
  slideCount: 0,
  dirty: false,
  saving: false,
  statusMessage: '',
  selectionCount: 0,
  selectionTag: '',
  textEditing: false,
  popover: null // { type: 'math' | 'code', value, lang }
})

// Non-reactive handles to live DOM machinery (never proxied by Svelte).
export const runtime = {
  bridge: null,
  overlay: null,
  editMode: null,
  popoverEl: null,
  popoverOriginal: null
}
