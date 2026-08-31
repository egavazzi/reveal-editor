// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import { toggleFragment } from '../../src/client/lib/actions.js'
import { cleanSlides } from '../../src/client/lib/model/clean.js'
import { DEFAULT_SETTINGS } from '../../src/client/lib/model/settings.js'

let selection = []

function makeBridge() {
  const slidesEl = document.querySelector('.slides')
  return {
    slidesEl,
    doc: document,
    win: {},
    Reveal: { configure() {}, getPlugin() { return null } },
    config: () => ({ width: 960, height: 700, margin: 0.04 }),
    getSections: () => [...slidesEl.children].filter((el) => el.tagName === 'SECTION'),
    get currentSection() { return slidesEl.querySelector('section') },
    getIndex: () => ({ h: 0, v: 0 }),
    sync() {},
    goTo() {}
  }
}

describe('fragments', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div class="reveal"><div class="slides"><section class="re-slide">' +
      '<p class="re-el fragment visible current-fragment" id="f">step</p>' +
      '</section></div></div>'
    runtime.bridge = makeBridge()
    runtime.editMode = null
    selection = [document.getElementById('f')]
    runtime.overlay = {
      getSelection: () => selection,
      setSelection(els) { selection = els },
      reconfigure() {},
      refresh() {}
    }
    editor.slideIndex = { h: 0, v: 0 }
    editor.settings = { ...DEFAULT_SETTINGS }
    editor.autosave = false
  })

  it('takes reveal’s runtime fragment classes off with the fragment', () => {
    toggleFragment()
    const el = document.getElementById('f')
    expect(el.classList.contains('fragment')).toBe(false)
    // the save cleaner only visits .fragment elements, so these would
    // otherwise be written to the deck file
    expect(el.classList.contains('visible')).toBe(false)
    expect(el.classList.contains('current-fragment')).toBe(false)
    expect(cleanSlides(runtime.bridge.slidesEl)).toContain('<p class="re-el" id="f">step</p>')
  })
})
