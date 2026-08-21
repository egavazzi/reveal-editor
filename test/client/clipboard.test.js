// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import {
  duplicateSelection, handleCopy, handlePaste, undoAction
} from '../../src/client/lib/actions.js'
import { startTextEdit, stopTextEdit } from '../../src/client/lib/editors/text.js'
import { DEFAULT_SETTINGS } from '../../src/client/lib/model/settings.js'

/** A clipboard event whose data behaves like the system clipboard. */
function clipboardEvent(entries = {}) {
  const store = { ...entries }
  return {
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    clipboardData: {
      items: [],
      getData: (type) => store[type] ?? '',
      setData: (type, value) => { store[type] = value }
    },
    get data() { return store }
  }
}

let selection = []
let current = 0

describe('clipboard', () => {
  beforeEach(() => {
    document.execCommand = () => true
    document.body.innerHTML =
      '<div class="reveal"><div class="slides"><section>' +
      '<div class="re-el re-text" style="position: absolute; left: 100px; top: 60px"><p>Copied box</p></div>' +
      '</section><section></section></div></div>'
    const slidesEl = document.querySelector('.slides')
    const sections = () => [...slidesEl.children].filter((el) => el.tagName === 'SECTION')
    current = 0
    runtime.bridge = {
      slidesEl,
      doc: document,
      win: {},
      Reveal: { configure() {} },
      config: () => ({ width: 960, height: 700 }),
      get currentSection() { return sections()[current] },
      getSections: sections,
      getSlide: (h = current) => sections()[h],
      getIndex: () => ({ h: current, v: 0 }),
      goTo(h) { current = h },
      sync() {}
    }
    selection = []
    runtime.overlay = {
      getSelection: () => selection,
      setSelection(els) { selection = els },
      refresh() {}
    }
    editor.slideIndex = { h: 0, v: 0 }
    editor.settings = { ...DEFAULT_SETTINGS }
    editor.autosave = false
    editor.textEditing = false
  })

  const boxes = (h = current) => runtime.bridge.getSections()[h].querySelectorAll('.re-text')

  /** Move to another slide, the way the sidebar does. */
  function goTo(h) {
    current = h
    editor.slideIndex = { h, v: 0 }
  }

  it('puts copied elements on the system clipboard and pastes them back', () => {
    selection = [document.querySelector('.re-text')]
    const copy = clipboardEvent()
    handleCopy(copy)

    expect(copy.defaultPrevented).toBe(true)
    expect(copy.data['text/html']).toContain('data-re-clipboard')
    // other applications get something readable, not editor markup
    expect(copy.data['text/plain']).toBe('Copied box')

    const paste = clipboardEvent(copy.data)
    handlePaste(paste)

    expect(paste.defaultPrevented).toBe(true)
    expect(boxes()).toHaveLength(2)
    expect(boxes()[1].textContent).toBe('Copied box')
    // pasted elements are offset from the original, not stacked on it
    expect(boxes()[1].style.left).toBe('124px')
  })

  it('pastes onto another slide at the coordinates it was copied from', () => {
    selection = [document.querySelector('.re-text')]
    const copy = clipboardEvent()
    handleCopy(copy)

    goTo(1)
    handlePaste(clipboardEvent(copy.data))

    expect(boxes()).toHaveLength(1)
    // in place, so the same element can hold the same spot on several slides
    expect(boxes()[0].style.left).toBe('100px')
    expect(boxes()[0].style.top).toBe('60px')
  })

  it('steps each further paste off the copies already on that slide', () => {
    selection = [document.querySelector('.re-text')]
    const copy = clipboardEvent()
    handleCopy(copy)

    handlePaste(clipboardEvent(copy.data))
    handlePaste(clipboardEvent(copy.data))
    expect([...boxes()].map((el) => el.style.left)).toEqual(['100px', '124px', '148px'])

    goTo(1)
    handlePaste(clipboardEvent(copy.data))
    handlePaste(clipboardEvent(copy.data))
    // the first one had the slide to itself; the second must not hide under it
    expect([...boxes()].map((el) => el.style.left)).toEqual(['100px', '124px'])
  })

  it('offsets a duplicate, which is always in place, and cascades further ones', () => {
    selection = [document.querySelector('.re-text')]
    duplicateSelection()
    duplicateSelection()

    expect([...boxes()].map((el) => el.style.left)).toEqual(['100px', '124px', '148px'])
  })

  it('forgets the cascade when undo takes the pasted copies away again', () => {
    selection = [document.querySelector('.re-text')]
    const copy = clipboardEvent()
    handleCopy(copy)

    goTo(1)
    handlePaste(clipboardEvent(copy.data))
    undoAction()
    handlePaste(clipboardEvent(copy.data))

    // the undone paste is gone, so this one has the spot to itself again
    expect(boxes()).toHaveLength(1)
    expect(boxes()[0].style.left).toBe('100px')
  })

  // The bug: a copy inside the editor used to win over everything copied
  // afterwards anywhere else, for the rest of the session.
  it('pastes text copied in another application, even after copying an element', () => {
    selection = [document.querySelector('.re-text')]
    handleCopy(clipboardEvent())

    const paste = clipboardEvent({ 'text/plain': 'from another app' })
    handlePaste(paste)

    expect(paste.defaultPrevented).toBe(true)
    expect(boxes()).toHaveLength(2)
    expect(boxes()[1].textContent).toBe('from another app')
  })

  it('leaves the clipboard to the browser while editing text', () => {
    startTextEdit(document.querySelector('.re-text p'), runtime.bridge)

    const copy = clipboardEvent()
    handleCopy(copy)
    expect(copy.defaultPrevented).toBe(false)
    expect(copy.data['text/html']).toBeUndefined()

    const paste = clipboardEvent({ 'text/plain': 'typed in' })
    handlePaste(paste)
    expect(paste.defaultPrevented).toBe(false)
    expect(boxes()).toHaveLength(1)
    stopTextEdit()
  })
})
