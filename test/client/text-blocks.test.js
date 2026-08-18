// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { startTextEdit, stopTextEdit, setBlockStyle, queryFormatState } from '../../src/client/lib/editors/text.js'

const bridge = () => ({ doc: document, win: window })

describe('block styles on directly edited elements', () => {
  beforeEach(() => {
    // happy-dom has no editing API; the code guards query* with try/catch
    // and only calls execCommand for state toggles irrelevant to these tests
    document.execCommand = () => true
    document.body.innerHTML =
      '<div class="reveal"><div class="slides"><section>' +
      '<h1 class="re-el" style="position: absolute; left: 10px; font-size: 52px;">Title</h1>' +
      '</section></div></div>'
  })

  it('reports the edited heading element itself as the block style', () => {
    startTextEdit(document.querySelector('h1'), bridge())
    expect(queryFormatState().block).toBe('h1')
    stopTextEdit()
  })

  it('retags the host element instead of nesting a block inside it', () => {
    startTextEdit(document.querySelector('h1'), bridge())
    setBlockStyle('h2')

    const section = document.querySelector('section')
    expect(section.children).toHaveLength(1)
    const el = section.firstElementChild
    expect(el.tagName).toBe('H2')
    expect(el.querySelector('h1, h2')).toBeNull()
    // attributes, styling, content, and the live edit session all carry over
    expect(el.getAttribute('style')).toContain('left: 10px')
    expect(el.className).toBe('re-el')
    expect(el.textContent).toBe('Title')
    expect(el.getAttribute('contenteditable')).toBe('true')
    expect(queryFormatState().block).toBe('h2')

    stopTextEdit()
    expect(el.hasAttribute('contenteditable')).toBe(false)
  })

  it('retags a heading back to a normal paragraph', () => {
    startTextEdit(document.querySelector('h1'), bridge())
    setBlockStyle('p')
    expect(document.querySelector('section').firstElementChild.tagName).toBe('P')
    stopTextEdit()
  })
})
