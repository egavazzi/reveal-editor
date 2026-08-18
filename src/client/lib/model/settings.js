// Deck-level presentation/editor settings. They live inside .slides as a
// small JSON <template>, so they are covered by the existing lossless save
// path and remain easy to inspect or edit by hand.
import { editor, runtime } from '../../stores/editor.svelte.js'

export const REVEAL_THEMES = Object.freeze([
  'black', 'white', 'league', 'beige', 'sky', 'night', 'serif', 'simple',
  'solarized', 'moon', 'dracula', 'blood', 'black-contrast', 'white-contrast'
])

export const TYPOGRAPHY_PRESETS = Object.freeze([
  { id: '', label: 'Theme default' },
  { id: 'system', label: 'Modern system' },
  { id: 'serif', label: 'Classic serif' },
  { id: 'geometric', label: 'Geometric sans' },
  { id: 'mono', label: 'Technical mono' }
])

const TYPOGRAPHY_CSS = {
  system: ['system-ui, sans-serif', 'system-ui, sans-serif', 'ui-monospace, monospace'],
  serif: ['Georgia, serif', 'Georgia, serif', 'ui-monospace, monospace'],
  geometric: ['Avenir Next, Avenir, Century Gothic, system-ui, sans-serif',
    'Avenir Next, Avenir, Century Gothic, system-ui, sans-serif', 'ui-monospace, monospace'],
  mono: ['ui-monospace, SFMono-Regular, Consolas, monospace',
    'ui-monospace, SFMono-Regular, Consolas, monospace', 'ui-monospace, monospace']
}

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
  slideNumberPosition: 'bottom-right',
  theme: '',
  typography: '',
  transition: 'slide',
  transitionSpeed: 'default',
  // presentation extras (runtime script features; no plugins required)
  laserPointer: false,
  clickZoom: false,
  mouseWheel: false,
  loop: false,
  autoSlide: 0
})

const TEMPLATE_SELECTOR = 'template[data-re-settings]'
const STYLE_SELECTOR = 'style[data-re-settings-style]'
const SCRIPT_SELECTOR = 'script[data-re-settings-runtime]'
const PREVIEW_STYLE_ID = 're-settings-preview-style'

export function hasStoredSettings(slidesEl) {
  return Boolean(slidesEl?.querySelector(TEMPLATE_SELECTOR))
}

export function themeFromDocument(doc) {
  const href = doc?.querySelector(
    'link[rel~="stylesheet"][href*="/theme/"], link[rel~="stylesheet"][href^="theme/"]'
  )?.getAttribute('href') || ''
  return href.match(/(?:^|\/theme\/)([^/?#]+)\.css(?:[?#].*)?$/)?.[1] || ''
}

export function applyTheme(doc, theme) {
  if (!doc || !/^[a-z0-9_-]+$/i.test(theme || '')) return false
  const link = doc.querySelector(
    'link[rel~="stylesheet"][href*="/theme/"], link[rel~="stylesheet"][href^="theme/"]'
  )
  if (!link) return false
  const href = link.getAttribute('href') || ''
  const next = href.replace(
    /(^|.*\/theme\/)[^/?#]+(\.css(?:[?#].*)?)$/,
    `$1${theme}$2`
  )
  if (next === href || next === '') return next !== ''
  link.setAttribute('href', next)
  return true
}

export function settingsFromRevealConfig(config = {}, doc = null) {
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
      : DEFAULT_SETTINGS.slideNumberFormat,
    theme: themeFromDocument(doc),
    transition: config.transition || DEFAULT_SETTINGS.transition,
    transitionSpeed: config.transitionSpeed || DEFAULT_SETTINGS.transitionSpeed
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
  const fonts = TYPOGRAPHY_CSS[s.typography]
  const typography = fonts
    ? `.reveal { --r-main-font: ${fonts[0]}; --r-heading-font: ${fonts[1]}; --r-code-font: ${fonts[2]}; }`
    : ''
  return `
${s.controls ? '' : '.reveal .controls { display: none !important; }'}
.reveal .slide-number { ${v}; ${h}; }
.reveal [data-re-href] { cursor: pointer; }
${typography}
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
      showSlideNumber: 'all', transition: s.transition || 'slide',
      transitionSpeed: s.transitionSpeed || 'default',
      mouseWheel: s.mouseWheel === true, loop: s.loop === true,
      autoSlide: Number(s.autoSlide) > 0 ? Number(s.autoSlide) * 1000 : 0 });
    if (/^[a-z0-9_-]+$/i.test(s.theme || '')) {
      const link = document.querySelector('link[rel~="stylesheet"][href*="/theme/"], link[rel~="stylesheet"][href^="theme/"]');
      if (link) {
        const href = link.getAttribute('href') || '';
        const next = href.replace(/(^|.*\\/theme\\/)[^/?#]+(\\.css(?:[?#].*)?)$/, '$1' + s.theme + '$2');
        if (next && next !== href) {
          link.addEventListener('load', () => Reveal.layout(), { once: true });
          link.setAttribute('href', next);
        }
      }
    }
    const controls = document.querySelector('.reveal .controls');
    if (controls && s.controls === false) controls.style.setProperty('display', 'none', 'important');
    Reveal.layout();
    if (!location.search.includes('editmode=1')) {
      document.addEventListener('click', e => {
        const el = e.target.closest('[data-re-href]');
        if (el) window.open(el.dataset.reHref, '_blank', 'noopener');
      });
      if (s.laserPointer) {
        const dot = document.createElement('div');
        dot.style.cssText = 'position:fixed;z-index:2147483647;width:14px;height:14px;' +
          'margin:-7px 0 0 -7px;border-radius:50%;pointer-events:none;display:none;' +
          'background:radial-gradient(circle,#ff6666 0%,#dd0000 55%,rgba(221,0,0,0) 100%);' +
          'box-shadow:0 0 14px 5px rgba(255,40,40,.55)';
        document.body.appendChild(dot);
        let laserOn = false;
        document.addEventListener('keydown', e => {
          if (e.key !== 'l' && e.key !== 'L') return;
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (/^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable) return;
          laserOn = !laserOn;
          dot.style.display = laserOn ? 'block' : 'none';
          document.documentElement.style.cursor = laserOn ? 'none' : '';
        });
        document.addEventListener('mousemove', e => {
          if (!laserOn) return;
          dot.style.left = e.clientX + 'px';
          dot.style.top = e.clientY + 'px';
        });
      }
      if (s.clickZoom) {
        let zoomed = false;
        const reset = () => {
          zoomed = false;
          document.body.style.transform = '';
        };
        document.addEventListener('click', e => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          if (zoomed) return reset();
          zoomed = true;
          document.body.style.transition = 'transform .25s ease';
          document.body.style.transformOrigin = e.clientX + 'px ' + e.clientY + 'px';
          document.body.style.transform = 'scale(2)';
        }, true);
        document.addEventListener('keydown', e => {
          if (e.key === 'Escape' && zoomed) reset();
        });
      }
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
  applyTheme(bridge.doc, s.theme)
  const controls = bridge.doc.querySelector('.reveal .controls')
  if (s.controls) controls?.style.removeProperty('display')
  bridge.Reveal.configure({
    width: Number(s.width) || 960,
    height: Number(s.height) || 700,
    margin: Math.max(0, Number(s.margin) || 0) / 100,
    controls: Boolean(s.controls),
    slideNumber: s.slideNumbers ? (s.slideNumberFormat || 'c/t') : false,
    showSlideNumber: 'all',
    transition: 'none',
    transitionSpeed: s.transitionSpeed || 'default'
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
