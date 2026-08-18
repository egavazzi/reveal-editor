// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { duplicateSlide } from '../../src/client/lib/model/slides.js'

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
})
