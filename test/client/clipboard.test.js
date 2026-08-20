// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import { handleCopy, handlePaste } from '../../src/client/lib/actions.js'
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

describe('clipboard', () => {
  beforeEach(() => {
    document.execCommand = () => true
    document.body.innerHTML =
      '<div class="reveal"><div class="slides"><section>' +
      '<div class="re-el re-text" style="position: absolute; left: 100px; top: 60px"><p>Copied box</p></div>' +
      '</section></div></div>'
    const slidesEl = document.querySelector('.slides')
    runtime.bridge = {
      slidesEl,
      doc: document,
      win: {},
      Reveal: { configure() {} },
      config: () => ({ width: 960, height: 700 }),
      get currentSection() { return slidesEl.querySelector('section') },
      getSections: () => [...slidesEl.children].filter((el) => el.tagName === 'SECTION'),
      getSlide: () => slidesEl.querySelector('section'),
      getIndex: () => ({ h: 0, v: 0 }),
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

  const boxes = () => document.querySelectorAll('.slides section .re-text')

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
