// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import {
  redoAction, selectedImageInfo, setImageProperties, undoAction, updateDeckSettings
} from '../../src/client/lib/actions.js'
import { DEFAULT_SETTINGS } from '../../src/client/lib/model/settings.js'

function makeBridge() {
  const slidesEl = document.querySelector('.slides')
  const bridge = {
    slidesEl,
    doc: document,
    win: {},
    Reveal: {
      configure() {},
      getPlugin() { return null }
    },
    config: () => ({ width: 960, height: 700, margin: 0.04, controls: true }),
    getSections: () => [...slidesEl.children].filter((el) => el.tagName === 'SECTION'),
    getIndex: () => ({ h: 0, v: 0 }),
    sync() {},
    goTo() {}
  }
  return bridge
}

describe('settings actions', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = '<div class="reveal"><div class="slides"><section><p>Hello</p></section></div></div>'
    runtime.bridge = makeBridge()
    runtime.editMode = null
    runtime.overlay = {
      getSelection: () => [],
      setSelection() {},
      reconfigure() {},
      refresh() {}
    }
    editor.slideIndex = { h: 0, v: 0 }
    editor.settings = { ...DEFAULT_SETTINGS }
    editor.autosave = false
  })

  it('undoes and redoes the first settings change without losing the original no-settings state', () => {
    updateDeckSettings({ width: 1280 })
    expect(runtime.bridge.slidesEl.querySelector('template[data-re-settings]')).not.toBeNull()
    expect(editor.settings.width).toBe(1280)

    undoAction()
    expect(runtime.bridge.slidesEl.querySelector('template[data-re-settings]')).toBeNull()
    expect(editor.settings.width).toBe(960)

    redoAction()
    expect(runtime.bridge.slidesEl.querySelector('template[data-re-settings]')).not.toBeNull()
    expect(editor.settings.width).toBe(1280)
  })

  it('undoes a theme change and restores the previous stylesheet', () => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    // A data URL exercises the theme-path replacement without making
    // happy-dom fetch a nonexistent localhost stylesheet.
    link.href = 'data:text/css,/theme/white.css'
    document.head.appendChild(link)
    editor.settings.theme = 'white'

    updateDeckSettings({ theme: 'moon' })
    expect(link.getAttribute('href')).toContain('/theme/moon.css')

    undoAction()
    expect(editor.settings.theme).toBe('white')
    expect(link.getAttribute('href')).toContain('/theme/white.css')
  })

  it('keeps valid zero-percent crop positions', () => {
    const image = document.createElement('img')
    image.style.objectPosition = '0% 0%'
    runtime.overlay.getSelection = () => [image]

    expect(selectedImageInfo()).toMatchObject({ cropX: 0, cropY: 0 })
  })

  it('adds link runtime support explicitly and removes it again on undo', () => {
    const image = document.createElement('img')
    runtime.bridge.getSections()[0].appendChild(image)
    runtime.overlay.getSelection = () => [image]

    setImageProperties({ href: 'https://example.com/slides' })
    expect(runtime.bridge.slidesEl.querySelector('script[data-re-settings-runtime]')).not.toBeNull()
    expect(image.getAttribute('data-re-href')).toBe('https://example.com/slides')

    undoAction()
    expect(runtime.bridge.slidesEl.querySelector('[data-re-settings]')).toBeNull()
    expect(runtime.bridge.slidesEl.querySelector('img').hasAttribute('data-re-href')).toBe(false)
  })
})
