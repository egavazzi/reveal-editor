// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { duplicateSlide, toggleSlideHidden } from '../../src/client/lib/model/slides.js'

describe('slide structure', () => {
  it('strips nested ids when duplicating a slide', () => {
    document.body.innerHTML = `
      <div class="slides">
        <section id="slide-one"><div id="chart"><span id="label">A</span></div></section>
      </div>`
    const slidesEl = document.querySelector('.slides')
    const bridge = {
      doc: document,
      getSections: () => [...slidesEl.children].filter((el) => el.tagName === 'SECTION'),
      sync() {},
      goTo() {}
    }

    const duplicate = duplicateSlide(bridge, 0)

    expect(duplicate.querySelectorAll('[id]')).toHaveLength(0)
    expect(duplicate.hasAttribute('id')).toBe(false)
    expect(document.querySelectorAll('#chart')).toHaveLength(1)
  })

  it('toggles data-visibility="hidden" on horizontal and vertical slides', () => {
    document.body.innerHTML = `
      <div class="slides">
        <section><p>One</p></section>
        <section>
          <section><p>Stacked A</p></section>
          <section><p>Stacked B</p></section>
        </section>
      </div>`
    const slidesEl = document.querySelector('.slides')
    let synced = 0
    const bridge = {
      doc: document,
      getSections: () => [...slidesEl.children].filter((el) => el.tagName === 'SECTION'),
      getSlide(h, v = 0) {
        const horizontal = bridge.getSections()[h]
        if (!horizontal) return null
        const vertical = [...horizontal.children].filter((el) => el.tagName === 'SECTION')
        return vertical.length ? vertical[v] ?? null : horizontal
      },
      sync() { synced++ }
    }

    expect(toggleSlideHidden(bridge, 0)).toBe(true)
    expect(bridge.getSections()[0].getAttribute('data-visibility')).toBe('hidden')
    expect(toggleSlideHidden(bridge, 0)).toBe(false)
    expect(bridge.getSections()[0].hasAttribute('data-visibility')).toBe(false)

    expect(toggleSlideHidden(bridge, 1, 1)).toBe(true)
    expect(bridge.getSlide(1, 1).getAttribute('data-visibility')).toBe('hidden')
    // the stack container itself stays untouched
    expect(bridge.getSections()[1].hasAttribute('data-visibility')).toBe(false)

    expect(toggleSlideHidden(bridge, 5)).toBe(null)
    expect(synced).toBe(3)
  })
})
