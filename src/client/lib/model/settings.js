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
  slideNumbers: false,
  slideNumberFormat: 'c/t',
  slideNumberPosition: 'bottom-right'
})

const TEMPLATE_SELECTOR = 'template[data-re-settings]'
const STYLE_SELECTOR = 'style[data-re-settings-style]'
const SCRIPT_SELECTOR = 'script[data-re-settings-runtime]'
const PREVIEW_STYLE_ID = 're-settings-preview-style'

export function hasStoredSettings(slidesEl) {
  return Boolean(slidesEl?.querySelector(TEMPLATE_SELECTOR))
}

export function settingsFromRevealConfig(config = {}) {
  return {
    ...DEFAULT_SETTINGS,
    width: Number(config.width) || DEFAULT_SETTINGS.width,
    height: Number(config.height) || DEFAULT_SETTINGS.height,
    margin: Number.isFinite(Number(config.margin))
      ? Number(config.margin) * 100
      : DEFAULT_SETTINGS.margin,
    controls: config.controls !== false,
    slideNumbers: Boolean(config.slideNumber),
    slideNumberFormat: typeof config.slideNumber === 'string'
      ? config.slideNumber
      : DEFAULT_SETTINGS.slideNumberFormat
  }
}

export function readSettings(slidesEl) {
  const template = slidesEl?.querySelector(TEMPLATE_SELECTOR)
  if (!template) return { ...DEFAULT_SETTINGS }
  try {
    const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(template.innerHTML) }
    // Drop navigation appearance fields written by older builds. Reveal's
    // native controls automatically adapt to light and dark backgrounds.
    delete settings.navColor
    delete settings.navBackground
    delete settings.navSize
    delete settings.navRadius
    delete settings.navOpacity
    return settings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function settingsCss(s) {
  const [vertical, horizontal] = s.slideNumberPosition.split('-')
  const v = vertical === 'top' ? 'top: 12px; bottom: auto' : 'bottom: 12px; top: auto'
  const right = s.controls && vertical !== 'top' ? 100 : 12
  const h = horizontal === 'left' ? 'left: 12px; right: auto' : `right: ${right}px; left: auto`
  return `
${s.controls ? '' : '.reveal .controls { display: none !important; }'}
.reveal .slide-number { ${v}; ${h}; }
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
      slideNumber: s.slideNumbers ? (s.slideNumberFormat || 'c/t') : false,
      showSlideNumber: 'all' });
    const controls = document.querySelector('.reveal .controls');
    if (controls && s.controls === false) controls.style.setProperty('display', 'none', 'important');
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

export function initializeSettings(bridge, fallbackSettings = null) {
  const stored = hasStoredSettings(bridge.slidesEl)
  editor.settings = stored
    ? readSettings(bridge.slidesEl)
    : { ...(fallbackSettings || settingsFromRevealConfig(bridge.config())) }
  // Refresh derived support nodes for managed decks. This also removes
  // obsolete navigation styling produced by older editor builds.
  if (stored) writeSettings(bridge.slidesEl, editor.settings)
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
  const controls = bridge.doc.querySelector('.reveal .controls')
  if (s.controls) controls?.style.removeProperty('display')
  bridge.Reveal.configure({
    width: Number(s.width) || 960,
    height: Number(s.height) || 700,
    margin: Math.max(0, Number(s.margin) || 0) / 100,
    controls: Boolean(s.controls),
    slideNumber: s.slideNumbers ? (s.slideNumberFormat || 'c/t') : false,
    showSlideNumber: 'all'
  })
  if (!s.controls) controls?.style.setProperty('display', 'none', 'important')
  let previewStyle = bridge.doc.getElementById(PREVIEW_STYLE_ID)
  if (!previewStyle) {
    previewStyle = bridge.doc.createElement('style')
    previewStyle.id = PREVIEW_STYLE_ID
    bridge.doc.head.appendChild(previewStyle)
  }
  previewStyle.textContent = settingsCss(s)
  bridge.doc.documentElement.style.setProperty('--re-grid-size', `${s.gridSize}px`)
  bridge.doc.documentElement.style.setProperty('--re-safe-margin', `${s.margin}%`)
  bridge.doc.body.classList.toggle('re-show-grid', Boolean(s.showGrid))
  runtime.editMode?.relayout()
}
