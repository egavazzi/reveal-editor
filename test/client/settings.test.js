// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, applyTheme, initializeSettings, readSettings,
  settingsFromRevealConfig, themeFromDocument, writeSettings
} from '../../src/client/lib/model/settings.js'
import { cleanSlides } from '../../src/client/lib/model/clean.js'

describe('deck settings', () => {
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
})
