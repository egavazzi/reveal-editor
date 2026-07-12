// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, initializeSettings, readSettings,
  settingsFromRevealConfig, writeSettings
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

  it('falls back safely when settings JSON is malformed', () => {
    document.body.innerHTML = '<div class="slides"><template data-re-settings>{bad</template></div>'
    expect(readSettings(document.querySelector('.slides'))).toEqual({ ...DEFAULT_SETTINGS })
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
})
