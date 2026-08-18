// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { arrangeElements } from '../../src/client/lib/model/alignment.js'

function element(left, top, width, height) {
  const el = document.createElement('div')
  Object.assign(el.style, {
    left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`
  })
  return el
}

describe('element arrangement', () => {
  it('aligns elements without changing their dimensions', () => {
    const elements = [element(10, 20, 100, 40), element(90, 80, 60, 20)]
    expect(arrangeElements(elements, 'right')).toBe(true)
    expect(elements.map((el) => el.style.left)).toEqual(['50px', '90px'])
    expect(elements.map((el) => el.style.width)).toEqual(['100px', '60px'])

    expect(arrangeElements(elements, 'middle')).toBe(true)
    expect(elements.map((el) => el.style.top)).toEqual(['40px', '50px'])
  })

  it('distributes variable-width elements with equal gaps', () => {
    const elements = [
      element(0, 0, 50, 20),
      element(70, 30, 20, 20),
      element(180, 60, 20, 20)
    ]
    expect(arrangeElements(elements, 'distribute-horizontal')).toBe(true)
    expect(elements.map((el) => el.style.left)).toEqual(['0px', '105px', '180px'])
  })

  it('requires three elements for distribution', () => {
    expect(arrangeElements([element(0, 0, 10, 10), element(20, 0, 10, 10)],
      'distribute-horizontal')).toBe(false)
  })
})
