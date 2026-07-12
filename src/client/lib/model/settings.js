// Deck-level presentation/editor settings. They live inside .slides as a
// small JSON <template>, so they are covered by the existing lossless save
// path and remain easy to inspect or edit by hand.
import { editor, runtime } from '../../stores/editor.svelte.js'

export const DEFAULT_SETTINGS = Object.freeze({
  width: 960,
  height: 700,
  margin: 4,
  showGrid: false,
  snapGrid: false,
  gridSize: 20,
  controls: true,
  navColor: '#2f6fba',
  navBackground: '#ffffff',
  navSize: 40,
  navRadius: 8,
  navOpacity: 0.85,
  slideNumbers: false,
  slideNumberFormat: 'c/t',
  slideNumberPosition: 'bottom-right'
})

const TEMPLATE_SELECTOR = 'template[data-re-settings]'
const STYLE_SELECTOR = 'style[data-re-settings-style]'
const SCRIPT_SELECTOR = 'script[data-re-settings-runtime]'

export function readSettings(slidesEl) {
  const template = slidesEl?.querySelector(TEMPLATE_SELECTOR)
  if (!template) return { ...DEFAULT_SETTINGS }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(template.innerHTML) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function settingsCss(s) {
  const [vertical, horizontal] = s.slideNumberPosition.split('-')
  const v = vertical === 'top' ? 'top: 12px; bottom: auto' : 'bottom: 12px; top: auto'
  const h = horizontal === 'left' ? 'left: 12px; right: auto' : 'right: 12px; left: auto'
  return `
body:not(.re-edit-mode) .reveal .controls { display: ${s.controls ? 'block' : 'none'} !important; opacity: ${s.navOpacity}; }
body:not(.re-edit-mode) .reveal .controls button { color: ${s.navColor}; width: ${s.navSize}px; height: ${s.navSize}px; border-radius: ${s.navRadius}px; background: ${s.navBackground}; }
body:not(.re-edit-mode) .reveal .slide-number { ${v}; ${h}; }
.reveal [data-re-href] { cursor: pointer; }
`.trim()
}

// This script makes settings work in decks not originally created from our
// template too. It executes only when the saved presentation is opened.
const RUNTIME_SCRIPT = `(() => {
  const apply = () => {
    const node = document.querySelector('.reveal .slides template[data-re-settings]');
    if (!node || !window.Reveal) return;
    let s = {}; try { s = JSON.parse(node.innerHTML); } catch {}
    Reveal.configure({ width: s.width || 960, height: s.height || 700,
      margin: (s.margin ?? 4) / 100, controls: s.controls !== false,
      slideNumber: s.slideNumbers ? (s.slideNumberFormat || 'c/t') : false });
    Reveal.layout();
    if (!location.search.includes('editmode=1')) {
      document.addEventListener('click', e => {
        const el = e.target.closest('[data-re-href]');
        if (el) window.open(el.dataset.reHref, '_blank', 'noopener');
      });
    }
  };
  addEventListener('load', () => setTimeout(apply, 0), { once: true });
})();`

export function writeSettings(slidesEl, settings) {
  let template = slidesEl.querySelector(TEMPLATE_SELECTOR)
  if (!template) {
    template = slidesEl.ownerDocument.createElement('template')
    template.setAttribute('data-re-settings', '')
    slidesEl.prepend(template)
  }
  template.innerHTML = JSON.stringify(settings, null, 2).replace(/</g, '\\u003c')

  let style = slidesEl.querySelector(STYLE_SELECTOR)
  if (!style) {
    style = slidesEl.ownerDocument.createElement('style')
    style.setAttribute('data-re-settings-style', '')
    template.after(style)
  }
  style.textContent = settingsCss(settings)

  let script = slidesEl.querySelector(SCRIPT_SELECTOR)
  if (!script) {
    script = slidesEl.ownerDocument.createElement('script')
    script.setAttribute('data-re-settings-runtime', '')
    style.after(script)
  }
  script.textContent = RUNTIME_SCRIPT
}

export function initializeSettings(bridge) {
  editor.settings = readSettings(bridge.slidesEl)
  applySettings(bridge)
}

export function updateSettings(patch) {
  Object.assign(editor.settings, patch)
  writeSettings(runtime.bridge.slidesEl, editor.settings)
  applySettings(runtime.bridge)
  runtime.overlay?.reconfigure()
}

export function applySettings(bridge) {
  if (!bridge) return
  const s = editor.settings
  bridge.Reveal.configure({
    width: Number(s.width) || 960,
    height: Number(s.height) || 700,
    margin: Math.max(0, Number(s.margin) || 0) / 100,
    controls: false, // editor chrome always hides presentation controls
    slideNumber: false
  })
  writeSettings(bridge.slidesEl, s)
  bridge.doc.documentElement.style.setProperty('--re-grid-size', `${s.gridSize}px`)
  bridge.doc.documentElement.style.setProperty('--re-safe-margin', `${s.margin}%`)
  bridge.doc.body.classList.toggle('re-show-grid', Boolean(s.showGrid))
  runtime.editMode?.relayout()
}
