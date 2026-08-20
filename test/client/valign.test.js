// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import { setTextVAlign, currentTextVAlign, undoAction } from '../../src/client/lib/actions.js'
import { DEFAULT_SETTINGS } from '../../src/client/lib/model/settings.js'

function makeBridge() {
  const slidesEl = document.querySelector('.slides')
  return {
    slidesEl,
    doc: document,
    win: {},
    Reveal: { configure() {}, getPlugin() { return null } },
    config: () => ({ width: 960, height: 700, margin: 0.04, controls: true }),
    getSections: () => [...slidesEl.children].filter((el) => el.tagName === 'SECTION'),
    get currentSection() { return slidesEl.querySelector('section') },
    getIndex: () => ({ h: 0, v: 0 }),
    sync() {},
    goTo() {}
  }
}

describe('vertical text alignment', () => {
  let box

  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML =
      '<div class="reveal"><div class="slides"><section>' +
      '<div class="re-el re-text" style="position: absolute; left: 10px; top: 10px; width: 360px; height: 200px"><p>Hello</p></div>' +
      '</section></div></div>'
    box = document.querySelector('.re-text')
    runtime.bridge = makeBridge()
    runtime.editMode = null
    runtime.overlay = {
      getSelection: () => [box],
      setSelection() {},
      reconfigure() {},
      refresh() {}
    }
    editor.slideIndex = { h: 0, v: 0 }
    editor.settings = { ...DEFAULT_SETTINGS }
    editor.autosave = false
  })

  it('maps middle and bottom to align-content and top back to unset', () => {
    expect(currentTextVAlign()).toBe('top')
    setTextVAlign('middle')
    expect(box.style.alignContent).toBe('center')
    expect(currentTextVAlign()).toBe('middle')
    setTextVAlign('bottom')
    expect(box.style.alignContent).toBe('end')
    expect(currentTextVAlign()).toBe('bottom')
    setTextVAlign('top')
    expect(box.style.alignContent).toBe('')
    expect(currentTextVAlign()).toBe('top')
  })

  it('keeps the existing height of an already sized box', () => {
    setTextVAlign('middle')
    expect(box.style.height).toBe('200px')
  })

  it('ignores images, shapes, and unknown values', () => {
    const img = document.createElement('img')
    runtime.bridge.getSections()[0].appendChild(img)
    runtime.overlay.getSelection = () => [img]
    setTextVAlign('middle')
    expect(img.style.alignContent ?? '').toBe('')
    runtime.overlay.getSelection = () => [box]
    setTextVAlign('diagonal')
    expect(box.style.alignContent).toBe('')
  })

  it('undoes an alignment change', () => {
    setTextVAlign('middle')
    expect(box.style.alignContent).toBe('center')
    undoAction()
    const restored = document.querySelector('.re-text')
    expect(restored.style.alignContent).toBe('')
  })
})
