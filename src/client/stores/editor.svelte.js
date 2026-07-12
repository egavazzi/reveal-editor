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
  statusMessage: ''
})

// Non-reactive handle to the iframe bridge (holds live DOM references).
export const runtime = {
  bridge: null
}
