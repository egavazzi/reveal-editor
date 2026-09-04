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
  exportProgress: null, // { id, done, total, label } while building standalone HTML
  statusMessage: '',
  // media conversion in flight: { name, target, progress } (null progress
  // means indeterminate); null when nothing is converting
  conversion: null,
  selectionCount: 0,
  selectionTag: '',
  selectionVersion: 0,
  textEditing: false,
  popover: null, // { type: 'math' | 'code' | 'html', value, lang }
  sidePanel: null, // 'layers' | 'settings' | 'notes' | 'image' | 'video' | 'shape' | 'element'
  // when pinned, the side panel never auto-switches or auto-closes on selection
  panelPinned: localStorage.getItem('reveal-editor:panel-pinned') === '1',
  arrangeOpen: false,
  // the "Optimize media" panel (media recompression) is open
  optimizeOpen: false,
  settings: {},
  // bumped whenever slide content changes; sidebar re-derives thumbnails
  docVersion: 0,
  autosave: localStorage.getItem('reveal-editor:autosave') === '1'
})

// Non-reactive handles to live DOM machinery (never proxied by Svelte).
export const runtime = {
  bridge: null,
  overlay: null,
  editMode: null,
  popoverEl: null,
  popoverOriginal: null
}
