// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import {
  redoAction, selectedImageInfo, setFragmentIndex, setImageProperties,
  setFontSize, setTextColor, undoAction, updateDeckSettings
} from '../../src/client/lib/actions.js'
import { DEFAULT_SETTINGS } from '../../src/client/lib/model/settings.js'
import { getCanvasSize } from '../../src/client/lib/overlay/editmode.js'
import { createShape } from '../../src/client/lib/model/shapes.js'

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

  it('uses the edited presentation size immediately for the design canvas', () => {
    updateDeckSettings({ width: 1280, height: 720 })
    expect(getCanvasSize(runtime.bridge)).toEqual({ width: 1280, height: 720 })
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

  it('undoes selected-object color and size changes without deleting the object', () => {
    const shape = createShape(document, 'rect')
    shape.style.position = 'absolute'
    shape.style.left = '10px'
    shape.style.top = '10px'
    runtime.bridge.getSections()[0].appendChild(shape)
    runtime.overlay.getSelection = () => [shape]

    setTextColor('#ff0000')
    undoAction()
    let restored = runtime.bridge.getSections()[0].querySelector('[data-shape="rect"]')
    expect(restored).not.toBeNull()
    expect(restored.querySelector('rect').getAttribute('stroke')).toBe('#2f6fba')

    runtime.overlay.getSelection = () => [restored]
    setFontSize(64)
    undoAction()
    restored = runtime.bridge.getSections()[0].querySelector('[data-shape="rect"]')
    expect(restored).not.toBeNull()
    expect(restored.style.fontSize).toBe('')
  })

  it('undoes fragment order changes', () => {
    const fragment = document.createElement('p')
    fragment.className = 'fragment'
    fragment.textContent = 'Later'
    runtime.bridge.getSections()[0].appendChild(fragment)
    runtime.overlay.getSelection = () => [fragment]

    setFragmentIndex(3)
    expect(fragment.getAttribute('data-fragment-index')).toBe('3')
    undoAction()
    expect(runtime.bridge.getSections()[0].querySelector('.fragment').hasAttribute('data-fragment-index')).toBe(false)
  })
})
