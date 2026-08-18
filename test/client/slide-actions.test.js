// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import { slideAdd, slideAddVertical, updateDeckSettings } from '../../src/client/lib/actions.js'
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
    get currentSection() { return slidesEl.querySelector('section') },
    getIndex: () => ({ h: 0, v: 0 }),
    // records what the newest section looked like at each sync, so tests can
    // assert reveal is re-synced only after layout attributes are in place
    syncLog: [],
    sync() {
      const sections = slidesEl.querySelectorAll('section')
      const last = sections[sections.length - 1]
      this.syncLog.push(last?.getAttribute('data-background-color') ?? null)
    },
    goTo() {}
  }
  return bridge
}

describe('slide actions', () => {
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
    editor.settings = { ...DEFAULT_SETTINGS, theme: 'uit' }
    editor.autosave = false
  })

  it('re-syncs reveal after a layout sets slide attributes (background layer)', () => {
    slideAdd('uit-content-dark')
    // the LAST sync must have seen the layout's background color; the sync
    // inside addSlide necessarily ran before the layout was applied
    expect(runtime.bridge.syncLog.at(-1)).toBe('#003349')
  })

  it('re-syncs after adding a vertical slide with a background-setting layout', () => {
    slideAddVertical('uit-closing')
    expect(runtime.bridge.syncLog.at(-1)).toBe('#003349')
  })

  it('adopts the template format when the theme switches to uit', () => {
    editor.settings = { ...DEFAULT_SETTINGS } // default 960x700, margin 4, no theme
    updateDeckSettings({ theme: 'uit' })
    expect(editor.settings.theme).toBe('uit')
    expect(editor.settings.width).toBe(1280)
    expect(editor.settings.height).toBe(720)
    expect(editor.settings.margin).toBe(0)
    expect(editor.settings.letterbox).toBe(true)
  })

  it('respects a deliberate custom canvas size when switching to uit', () => {
    editor.settings = { ...DEFAULT_SETTINGS, width: 1920, height: 1080 }
    updateDeckSettings({ theme: 'uit' })
    expect(editor.settings.width).toBe(1920)
    expect(editor.settings.height).toBe(1080)
    expect(editor.settings.margin).toBe(0)
  })
})
