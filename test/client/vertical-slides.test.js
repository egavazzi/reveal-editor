// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  addVerticalSlide, deleteCurrentSlide, demoteHorizontalSlide, duplicateCurrentSlide,
  moveCurrentSlide, promoteVerticalSlide, slideSummaries
} from '../../src/client/lib/model/slides.js'

function bridgeFixture() {
  document.body.innerHTML = '<div class="reveal"><div class="slides"><section><h2>One</h2></section><section><h2>Two</h2></section></div></div>'
  const slides = document.querySelector('.slides')
  let index = { h: 0, v: 0 }
  const bridge = {
    doc: document,
    slidesEl: slides,
    getSections: () => [...slides.children].filter((el) => el.tagName === 'SECTION'),
    getSlide(h, v = 0) {
      const horizontal = this.getSections()[h]
      const vertical = [...horizontal.children].filter((el) => el.tagName === 'SECTION')
      return vertical.length ? vertical[v] : horizontal
    },
    getSlideEntries() {
      return this.getSections().flatMap((horizontal, h) => {
        const vertical = [...horizontal.children].filter((el) => el.tagName === 'SECTION')
        return vertical.length
          ? vertical.map((section, v) => ({ section, h, v, vertical: true }))
          : [{ section: horizontal, h, v: 0, vertical: false }]
      })
    },
    sync() {},
    goTo(h, v = 0) { index = { h, v } },
    get index() { return index }
  }
  return bridge
}

describe('vertical slide stacks', () => {
  it('converts a horizontal slide into a stack and preserves its content', () => {
    const bridge = bridgeFixture()
    const added = addVerticalSlide(bridge, 0, 0)
    added.innerHTML = '<h2>One B</h2>'

    expect(bridge.getSections()).toHaveLength(2)
    expect(bridge.getSlideEntries().map((entry) => [entry.h, entry.v]))
      .toEqual([[0, 0], [0, 1], [1, 0]])
    expect(bridge.getSlide(0, 0).textContent).toContain('One')
    expect(bridge.index).toEqual({ h: 0, v: 1 })
  })

  it('duplicates, reorders, and collapses vertical stacks', () => {
    const bridge = bridgeFixture()
    addVerticalSlide(bridge, 0, 0).textContent = 'B'
    duplicateCurrentSlide(bridge, 0, 1).textContent = 'C'
    expect(bridge.getSlideEntries()).toHaveLength(4)

    expect(moveCurrentSlide(bridge, 0, 2, -1)).toBe(true)
    expect(bridge.getSlide(0, 1).textContent).toBe('C')
    expect(deleteCurrentSlide(bridge, 0, 1)).toBe(true)
    expect(deleteCurrentSlide(bridge, 0, 1)).toBe(true)
    expect(bridge.getSections()[0].textContent).toContain('One')
    expect(bridge.getSlideEntries()).toHaveLength(2)
  })

  it('includes horizontal and vertical indices in sidebar summaries', () => {
    const bridge = bridgeFixture()
    addVerticalSlide(bridge, 0, 0).textContent = 'B'
    expect(slideSummaries(bridge, { width: 960, height: 700 }).map((item) => item.id))
      .toEqual(['s0-0', 's0-1', 's1-0'])
  })

  it('demotes horizontal slides into stacks and promotes them out again', () => {
    const bridge = bridgeFixture()
    expect(demoteHorizontalSlide(bridge, 1)).toBe(true)
    expect(bridge.getSlideEntries().map((entry) => [entry.h, entry.v]))
      .toEqual([[0, 0], [0, 1]])
    expect(bridge.getSlide(0, 1).textContent).toContain('Two')

    expect(promoteVerticalSlide(bridge, 0, 1)).toBe(true)
    expect(bridge.getSlideEntries().map((entry) => [entry.h, entry.v]))
      .toEqual([[0, 0], [1, 0]])
    expect(bridge.getSlide(1, 0).textContent).toContain('Two')
  })
})
