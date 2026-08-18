// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { arrangeSlides } from '../../src/client/lib/model/arrange.js'

function makeBridge(html) {
  document.body.innerHTML = `<div class="slides">${html}</div>`
  const slidesEl = document.querySelector('.slides')
  return {
    doc: document,
    slidesEl,
    getSections: () => [...slidesEl.querySelectorAll(':scope > section')],
    getSlideEntries() {
      return this.getSections().flatMap((horizontal, h) => {
        const vertical = [...horizontal.children].filter((el) => el.tagName === 'SECTION')
        return vertical.length
          ? vertical.map((section, v) => ({ section, h, v, vertical: true }))
          : [{ section: horizontal, h, v: 0, vertical: false }]
      })
    },
    sync() {},
    goTo() {}
  }
}

function structure(slidesEl) {
  return [...slidesEl.querySelectorAll(':scope > section')].map((top) => {
    const vertical = [...top.children].filter((el) => el.tagName === 'SECTION')
    return vertical.length ? vertical.map((s) => s.id) : top.id
  })
}

describe('arrangeSlides', () => {
  it('builds a vertical stack from two horizontal slides', () => {
    const bridge = makeBridge('<section id="a"></section><section id="b"></section><section id="c"></section>')
    const [a, b, c] = bridge.getSections()

    expect(arrangeSlides(bridge, [[a, b], [c]])).toBe(true)
    expect(structure(bridge.slidesEl)).toEqual([['a', 'b'], 'c'])
  })

  it('flattens a stack back to horizontal slides and drops the wrapper', () => {
    const bridge = makeBridge('<section><section id="a"></section><section id="b"></section></section>')
    const [a, b] = bridge.getSlideEntries().map((e) => e.section)

    expect(arrangeSlides(bridge, [[b], [a]])).toBe(true)
    expect(structure(bridge.slidesEl)).toEqual(['b', 'a'])
    expect(bridge.slidesEl.querySelectorAll('section section')).toHaveLength(0)
  })

  it('keeps the wrapper (and its attributes) when a stack survives', () => {
    const bridge = makeBridge(
      '<section data-background-color="red"><section id="a"></section><section id="b"></section></section><section id="c"></section>'
    )
    const [a, b, c] = bridge.getSlideEntries().map((e) => e.section)

    expect(arrangeSlides(bridge, [[c], [b, a]])).toBe(true)
    expect(structure(bridge.slidesEl)).toEqual(['c', ['b', 'a']])
    const stack = bridge.slidesEl.querySelector(':scope > section:nth-child(2)')
    expect(stack.getAttribute('data-background-color')).toBe('red')
  })

  it('preserves the settings template and support nodes before the slides', () => {
    const bridge = makeBridge(
      '<template data-re-settings>{}</template><style data-re-settings-style></style><section id="a"></section><section id="b"></section>'
    )
    const [a, b] = bridge.getSections()

    arrangeSlides(bridge, [[b], [a]])

    expect(bridge.slidesEl.firstElementChild.matches('template[data-re-settings]')).toBe(true)
    expect(structure(bridge.slidesEl)).toEqual(['b', 'a'])
  })

  it('scrubs reveal runtime state from moved slides and wrappers', () => {
    const bridge = makeBridge(
      '<section id="a" class="present" hidden></section><section id="b" class="future"></section>'
    )
    const [a, b] = bridge.getSections()

    arrangeSlides(bridge, [[a, b]])

    const stack = bridge.slidesEl.querySelector(':scope > section')
    expect(a.classList.contains('present')).toBe(false)
    expect(a.hasAttribute('hidden')).toBe(false)
    expect(stack.classList.contains('stack')).toBe(false)
  })

  it('rejects a matrix that does not cover the deck', () => {
    const bridge = makeBridge('<section id="a"></section><section id="b"></section>')
    const [a, b] = bridge.getSections()

    expect(arrangeSlides(bridge, [[a]])).toBe(false)
    expect(arrangeSlides(bridge, [[a, a], [b]])).toBe(false)
    expect(structure(bridge.slidesEl)).toEqual(['a', 'b'])
  })
})
