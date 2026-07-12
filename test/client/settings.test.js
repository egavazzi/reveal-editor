// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, readSettings, writeSettings } from '../../src/client/lib/model/settings.js'
import { cleanSlides } from '../../src/client/lib/model/clean.js'

describe('deck settings', () => {
  it('round-trips readable settings and presentation support nodes', () => {
    document.body.innerHTML = '<div class="slides"><section><p>Hello</p></section></div>'
    const slides = document.querySelector('.slides')
    const settings = { ...DEFAULT_SETTINGS, width: 1280, height: 720, controls: false, slideNumbers: true }
    writeSettings(slides, settings)

    expect(readSettings(slides)).toEqual(settings)
    expect(slides.querySelector('style[data-re-settings-style]').textContent).toContain('display: none')
    expect(slides.querySelector('script[data-re-settings-runtime]').textContent).toContain('Reveal.configure')

    const saved = cleanSlides(slides)
    expect(saved).toContain('data-re-settings')
    expect(saved).toContain('"width": 1280')
  })

  it('falls back safely when settings JSON is malformed', () => {
    document.body.innerHTML = '<div class="slides"><template data-re-settings>{bad</template></div>'
    expect(readSettings(document.querySelector('.slides'))).toEqual({ ...DEFAULT_SETTINGS })
  })
})
