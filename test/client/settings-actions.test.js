// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import {
  currentSpeakerNotes, currentSlideTransition, redoAction, selectedImageInfo,
  groupSelection, selectedElementInfo, setCurrentSlideTransition, setElementProperties,
  setFragmentIndex, setFontSize, setTextColor,
  setImageProperties, setSpeakerNotes, setVideoProperties, ungroupSelection,
  markDirty, undoAction, updateDeckSettings
} from '../../src/client/lib/actions.js'
import { VIDEO_CONTROLS_ATTR } from '../../src/client/lib/model/videocontrols.js'
import { DEFAULT_SETTINGS } from '../../src/client/lib/model/settings.js'
import { getCanvasSize } from '../../src/client/lib/overlay/editmode.js'
import { createShape } from '../../src/client/lib/model/shapes.js'
import { wrapImage } from '../../src/client/lib/model/crop.js'

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

  it('uses the edited presentation size immediately for the design canvas', () => {
    updateDeckSettings({ width: 1280, height: 720 })
    expect(getCanvasSize(runtime.bridge)).toEqual({ width: 1280, height: 720 })
  })

  it('reports crop frames as images', () => {
    const frame = document.createElement('div')
    frame.className = 're-el re-image-frame'
    frame.style.width = '200px'
    frame.style.height = '100px'
    const image = document.createElement('img')
    image.setAttribute('data-re-href', 'https://example.com')
    frame.appendChild(image)
    runtime.overlay.getSelection = () => [frame]

    expect(selectedImageInfo()).toMatchObject({
      cropped: true, width: 200, height: 100, href: 'https://example.com'
    })

    runtime.overlay.getSelection = () => [image]
    expect(selectedImageInfo()).toMatchObject({ cropped: false })
  })

  it('leaves an auto height alone when only the width is edited', () => {
    const image = document.createElement('img')
    image.style.position = 'absolute'
    image.style.width = '400px' // no inline height, as ensurePositioned leaves it
    runtime.bridge.getSections()[0].appendChild(image)
    runtime.overlay.getSelection = () => [image]

    setImageProperties({ width: 500 })
    expect(image.style.width).toBe('500px')
    expect(image.style.height).toBe('')
  })

  it('scales the picture when a crop frame is resized via element properties', () => {
    const frame = document.createElement('div')
    frame.className = 're-el re-image-frame'
    Object.assign(frame.style, { position: 'absolute', left: '0px', top: '0px', width: '400px', height: '300px', overflow: 'hidden' })
    const image = document.createElement('img')
    Object.assign(image.style, { position: 'absolute', left: '-60px', top: '-20px', width: '400px', height: '300px' })
    frame.appendChild(image)
    runtime.bridge.getSections()[0].appendChild(frame)
    runtime.overlay.getSelection = () => [frame]

    setElementProperties({ width: 800, height: 150 })
    expect(frame.style.width).toBe('800px')
    expect(image.style.left).toBe('-120px')
    expect(image.style.top).toBe('-10px')
    expect(image.style.width).toBe('800px')
    expect(image.style.height).toBe('150px')
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

  it('adds control-bar runtime support for a cropped video and removes it on undo', () => {
    const frame = document.createElement('div')
    frame.className = 're-el re-image-frame'
    Object.assign(frame.style, { position: 'absolute', width: '340px', height: '200px' })
    const video = document.createElement('video')
    Object.assign(video.style, { position: 'absolute', left: '-60px', top: '-20px', width: '400px', height: '300px' })
    frame.appendChild(video)
    runtime.bridge.getSections()[0].appendChild(frame)
    runtime.overlay.getSelection = () => [frame]

    setVideoProperties({ controls: true })
    // a framed video asks the runtime for a bar, never the browser
    expect(video.hasAttribute(VIDEO_CONTROLS_ATTR)).toBe(true)
    expect(video.hasAttribute('controls')).toBe(false)
    expect(runtime.bridge.slidesEl.querySelector('script[data-re-settings-runtime]')).not.toBeNull()

    undoAction()
    expect(runtime.bridge.slidesEl.querySelector('[data-re-settings]')).toBeNull()
    expect(runtime.bridge.slidesEl.querySelector('video').hasAttribute(VIDEO_CONTROLS_ATTR)).toBe(false)
  })

  it('picks up a cropped video that arrives by any other edit', () => {
    const section = runtime.bridge.getSections()[0]
    section.innerHTML =
      `<div class="re-el re-image-frame"><video ${VIDEO_CONTROLS_ATTR}></video></div>`
    expect(runtime.bridge.slidesEl.querySelector('script[data-re-settings-runtime]')).toBeNull()

    markDirty()
    expect(runtime.bridge.slidesEl.querySelector('script[data-re-settings-runtime]')).not.toBeNull()
  })

  it('writes native speaker notes and per-slide transitions with undo', () => {
    setSpeakerNotes('Remember the demo')
    expect(currentSpeakerNotes()).toBe('Remember the demo')
    expect(runtime.bridge.currentSection.querySelector('aside.notes').textContent)
      .toBe('Remember the demo')

    setCurrentSlideTransition('zoom')
    expect(currentSlideTransition()).toBe('zoom')
    expect(runtime.bridge.currentSection.getAttribute('data-transition')).toBe('zoom')

    undoAction()
    expect(currentSlideTransition()).toBe('')
    expect(currentSpeakerNotes()).toBe('Remember the demo')
  })

  it('edits numeric geometry and groups without losing child positions', () => {
    const section = runtime.bridge.currentSection
    const first = document.createElement('div')
    const second = document.createElement('div')
    first.className = second.className = 're-el'
    Object.assign(first.style, { position: 'absolute', left: '10px', top: '20px', width: '100px', height: '40px' })
    Object.assign(second.style, { position: 'absolute', left: '150px', top: '70px', width: '80px', height: '30px' })
    section.append(first, second)
    let selection = [first]
    runtime.overlay.getSelection = () => selection
    runtime.overlay.setSelection = (next) => { selection = next }

    setElementProperties({ x: 25, rotation: 15, lockRatio: true })
    expect(selectedElementInfo()).toMatchObject({ x: 25, rotation: 15, lockRatio: true })

    selection = [first, second]
    expect(groupSelection()).toBe(true)
    const group = selection[0]
    expect(group.classList.contains('re-group')).toBe(true)
    expect(group.style.left).toBe('25px')
    expect(group.children).toHaveLength(2)

    expect(ungroupSelection()).toBe(true)
    expect(selection).toHaveLength(2)
    expect(selection[0].style.left).toBe('25px')
    expect(selection[1].style.left).toBe('150px')
  })

  it('locks the aspect ratio of pictures by default and records only departures from it', () => {
    const img = document.createElement('img')
    img.className = 're-el'
    Object.assign(img.style, { position: 'absolute', left: '10px', top: '10px', width: '200px', height: '100px' })
    const box = document.createElement('div')
    box.className = 're-el'
    Object.assign(box.style, { position: 'absolute', left: '10px', top: '10px', width: '200px', height: '100px' })
    runtime.bridge.getSections()[0].append(img, box)

    let selection = [img]
    runtime.overlay.getSelection = () => selection
    expect(selectedElementInfo().lockRatio).toBe(true)
    expect(img.hasAttribute('data-re-lock-ratio')).toBe(false)

    // unlocking a picture has to be recorded, since it is the exception
    setElementProperties({ lockRatio: false })
    expect(img.getAttribute('data-re-lock-ratio')).toBe('off')
    expect(selectedElementInfo().lockRatio).toBe(false)

    setElementProperties({ lockRatio: true })
    expect(img.hasAttribute('data-re-lock-ratio')).toBe(false)

    selection = [box]
    expect(selectedElementInfo().lockRatio).toBe(false)
    setElementProperties({ lockRatio: true })
    expect(box.getAttribute('data-re-lock-ratio')).toBe('')
  })

  it('keeps a cropped image locked by default, and carries an explicit unlock across the crop frame', () => {
    const img = document.createElement('img')
    img.className = 're-el'
    Object.assign(img.style, { position: 'absolute', left: '10px', top: '10px', width: '200px', height: '100px' })
    runtime.bridge.getSections()[0].append(img)

    // a crop frame stands in for its picture: resizing it scales the
    // picture too, so it must default to a locked ratio just the same
    let selection = [wrapImage(img)]
    runtime.overlay.getSelection = () => selection
    expect(selectedElementInfo().lockRatio).toBe(true)
    expect(selection[0].hasAttribute('data-re-lock-ratio')).toBe(false)

    setElementProperties({ lockRatio: false })
    expect(selection[0].getAttribute('data-re-lock-ratio')).toBe('off')
    expect(selectedElementInfo().lockRatio).toBe(false)
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
