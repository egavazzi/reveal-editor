// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS, applyTheme, initializeSettings, readSettings,
  settingsFromRevealConfig, themeFromDocument, writeSettings
} from '../../src/client/lib/model/settings.js'
import { cleanSlides } from '../../src/client/lib/model/clean.js'

describe('deck settings', () => {
  afterEach(() => { vi.useRealTimers() })

  it('round-trips readable settings and presentation support nodes', () => {
    document.body.innerHTML = '<div class="slides"><section><p>Hello</p></section></div>'
    const slides = document.querySelector('.slides')
    const settings = { ...DEFAULT_SETTINGS, width: 1280, height: 720, controls: false, slideNumbers: true }
    writeSettings(slides, settings)

    expect(readSettings(slides)).toEqual(settings)
    expect(slides.querySelector('style[data-re-settings-style]').textContent).toContain('.reveal .slide-number')
    expect(slides.querySelector('style[data-re-settings-style]').textContent)
      .toContain('.reveal .controls { display: none !important; }')
    expect(slides.querySelector('script[data-re-settings-runtime]').textContent).toContain('Reveal.configure')
    // edit mode must keep data-visibility="hidden" slides in the DOM
    expect(slides.querySelector('script[data-re-settings-runtime]').textContent).toContain('showHiddenSlides')
    expect(() => new Function(slides.querySelector('script[data-re-settings-runtime]').textContent)).not.toThrow()

    const saved = cleanSlides(slides)
    expect(saved).toContain('data-re-settings')
    expect(saved).toContain('"width": 1280')
  })

  it('persists presenting extras and ships them in the runtime script', () => {
    document.body.innerHTML = '<div class="slides"><section></section></div>'
    const slides = document.querySelector('.slides')
    const settings = { ...DEFAULT_SETTINGS, laserPointer: true, clickZoom: true, mouseWheel: true, loop: true, autoSlide: 30 }
    writeSettings(slides, settings)

    expect(readSettings(slides)).toEqual(settings)
    const runtime = slides.querySelector('script[data-re-settings-runtime]').textContent
    for (const feature of ['laserPointer', 'clickZoom', 'mouseWheel', 'loop', 'autoSlide']) {
      expect(runtime).toContain(feature)
    }
    // extras run only when presenting, never in the editor preview
    expect(runtime).toContain("editmode=1")
    expect(DEFAULT_SETTINGS.laserPointer).toBe(false)
    expect(DEFAULT_SETTINGS.autoSlide).toBe(0)
  })

  it('falls back safely when settings JSON is malformed', () => {
    document.body.innerHTML = '<div class="slides"><template data-re-settings>{bad</template></div>'
    expect(readSettings(document.querySelector('.slides'))).toEqual({ ...DEFAULT_SETTINGS })
  })

  it('detects and previews a vendored reveal theme without changing its path', () => {
    const link = document.createElement('link')
    link.setAttribute('rel', 'stylesheet')
    link.setAttribute('href', 'reveal/dist/theme/black.css?v=5')
    const doc = { querySelector: () => link }

    expect(themeFromDocument(doc)).toBe('black')
    expect(settingsFromRevealConfig({}, doc).theme).toBe('black')
    expect(applyTheme(doc, 'solarized')).toBe(true)
    expect(link.getAttribute('href')).toBe('reveal/dist/theme/solarized.css?v=5')
    expect(applyTheme(doc, '../unsafe')).toBe(false)
    expect(link.getAttribute('href')).toBe('reveal/dist/theme/solarized.css?v=5')
  })

  it('preserves a foreign deck config without adding saved settings nodes', () => {
    document.body.innerHTML = '<div class="reveal"><div class="slides"><section>Foreign deck</section></div><div class="slide-number"></div></div>'
    const slidesEl = document.querySelector('.slides')
    const config = {
      width: 1440,
      height: 900,
      margin: 0.08,
      controls: true,
      slideNumber: 'h.v'
    }
    let applied
    const bridge = {
      slidesEl,
      doc: document,
      config: () => config,
      Reveal: {
        configure: (settings) => { applied = settings }
      }
    }

    initializeSettings(bridge, settingsFromRevealConfig(config))

    expect(applied).toMatchObject({
      width: 1440,
      height: 900,
      margin: 0.08,
      controls: true,
      slideNumber: 'h.v',
      showSlideNumber: 'all'
    })
    expect(slidesEl.querySelector('[data-re-settings]')).toBeNull()
    expect(document.getElementById('re-settings-preview-style').textContent).toContain('right: 100px')
    expect(document.getElementById('re-settings-preview-style').textContent).not.toContain('.controls button')
  })

  it('removes legacy navigation appearance settings', () => {
    document.body.innerHTML = `<div class="slides"><template data-re-settings>${JSON.stringify({
      controls: true,
      navColor: '#ff0000',
      navBackground: '#ffffff',
      navSize: 80,
      navRadius: 20,
      navOpacity: 0.5
    })}</template></div>`
    const slides = document.querySelector('.slides')
    const settings = readSettings(slides)

    expect(settings.navColor).toBeUndefined()
    expect(settings.navBackground).toBeUndefined()
    writeSettings(slides, settings)
    expect(slides.querySelector('style[data-re-settings-style]').textContent).not.toContain('.controls')
  })

  it('hides controls authoritatively when legacy CSS tries to show them', () => {
    document.body.innerHTML = '<div class="reveal"><div class="slides"><section></section></div><aside class="controls"></aside></div>'
    const slidesEl = document.querySelector('.slides')
    const controls = document.querySelector('.controls')
    const bridge = {
      slidesEl,
      doc: document,
      config: () => ({ controls: false }),
      Reveal: { configure() {}, on() {} }
    }

    initializeSettings(bridge, { ...DEFAULT_SETTINGS, controls: false })

    expect(controls.style.getPropertyValue('display')).toBe('none')
    expect(controls.style.getPropertyPriority('display')).toBe('important')
    expect(document.getElementById('re-settings-preview-style').textContent)
      .toContain('.reveal .controls { display: none !important; }')
  })

  it('persists a typography preset as reveal CSS variables', () => {
    document.body.innerHTML = '<div class="slides"><section></section></div>'
    const slides = document.querySelector('.slides')
    writeSettings(slides, { ...DEFAULT_SETTINGS, typography: 'serif' })

    const css = slides.querySelector('style[data-re-settings-style]').textContent
    expect(css).toContain('--r-main-font: Georgia, serif')
    expect(css).toContain('--r-heading-font: Georgia, serif')
    expect(readSettings(slides).typography).toBe('serif')
  })

  // reveal's overview mode (O / Esc) moves .backgrounds inside the scaled
  // .slides element, so letterbox geometry measured against .reveal must not
  // follow it there — it used to stretch every slide background past its cell.
  it('keeps letterbox pinning out of overview mode', () => {
    vi.useFakeTimers()
    document.head.innerHTML = ''
    document.body.innerHTML =
      '<div class="reveal"><div class="slides"></div><div class="backgrounds"></div></div>'
    const slidesEl = document.querySelector('.slides')
    writeSettings(slidesEl, { ...DEFAULT_SETTINGS, letterbox: true })

    const reveal = document.querySelector('.reveal')
    const backgrounds = document.querySelector('.backgrounds')
    reveal.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1600, height: 800 })
    slidesEl.getBoundingClientRect = () => ({ left: 100, top: 0, width: 1400, height: 800 })
    const handlers = {}
    window.Reveal = {
      configure() {},
      layout() {},
      on(type, fn) { handlers[type] = fn }
    }
    new Function(slidesEl.querySelector('script[data-re-settings-runtime]').textContent)()
    window.dispatchEvent(new Event('load'))
    vi.runAllTimers()

    const letterboxWidth = () => reveal.style.getPropertyValue('--re-letterbox-width')
    // outside overview the layer is pinned to the slide area, and the pinning
    // is CSS the overview class can opt out of rather than inline geometry
    expect(letterboxWidth()).toBe('1400px')
    expect(backgrounds.getAttribute('style')).toBeNull()
    const css = [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('\n')
    expect(css).toContain('.reveal:not(.overview) .backgrounds')
    expect(css).toContain('.reveal.overview .backgrounds .slide-background')

    // measurements taken while the overview grid is open describe the shrunken
    // grid, so they must not overwrite the geometry used on the way out
    reveal.classList.add('overview')
    slidesEl.getBoundingClientRect = () => ({ left: 655, top: 326, width: 289, height: 163 })
    window.dispatchEvent(new Event('resize'))
    vi.runAllTimers()
    expect(letterboxWidth()).toBe('1400px')

    // a window resize during overview is picked up again once it closes
    slidesEl.getBoundingClientRect = () => ({ left: 0, top: 90, width: 1100, height: 620 })
    reveal.classList.remove('overview')
    handlers.overviewhidden()
    vi.runAllTimers()
    expect(letterboxWidth()).toBe('1100px')
  })
})
