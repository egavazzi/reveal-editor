// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import {
  selectedShapeInfo, setShapeProperties, setTextColor
} from '../../src/client/lib/actions.js'
import {
  createShape, setShapeColors, shapeColors, syncShapeGeometry
} from '../../src/client/lib/model/shapes.js'
import { DEFAULT_SETTINGS } from '../../src/client/lib/model/settings.js'

describe('shape editing', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="reveal"><div class="slides"><section></section></div></div>'
    const section = document.querySelector('section')
    runtime.bridge = {
      doc: document,
      slidesEl: document.querySelector('.slides'),
      currentSection: section,
      config: () => ({ width: 960, height: 700 }),
      getSections: () => [section],
      getIndex: () => ({ h: 0, v: 0 })
    }
    runtime.overlay = { getSelection: () => [], setSelection() {}, refresh() {} }
    editor.settings = { ...DEFAULT_SETTINGS }
    editor.slideIndex = { h: 0, v: 0 }
    editor.autosave = false
  })

  it('draws lines and arrows between opposite box corners', () => {
    const line = createShape(document, 'line')
    line.style.width = '120px'
    line.style.height = '80px'
    syncShapeGeometry(line)
    expect(line.querySelector('line').getAttribute('x1')).toBe('0')
    expect(line.querySelector('line').getAttribute('y1')).toBe('0')
    expect(line.querySelector('line').getAttribute('x2')).toBe('120')
    expect(line.querySelector('line').getAttribute('y2')).toBe('80')

    line.setAttribute('data-re-line-start', 'sw')
    syncShapeGeometry(line)
    expect(line.querySelector('line').getAttribute('y1')).toBe('80')
    expect(line.querySelector('line').getAttribute('y2')).toBe('0')

    const arrow = createShape(document, 'arrow')
    arrow.style.width = '120px'
    arrow.style.height = '80px'
    syncShapeGeometry(arrow)
    expect(arrow.querySelector('polygon').getAttribute('points').startsWith('120,80 ')).toBe(true)
  })

  it('round-trips fill, stroke, and stroke width', () => {
    const shape = createShape(document, 'rect')
    setShapeColors(shape, { fill: '#112233', stroke: '#abcdef', strokeWidth: 7 })
    expect(shapeColors(shape)).toEqual({ fill: '#112233', stroke: '#abcdef', strokeWidth: 7 })
    setShapeColors(shape, { strokeWidth: 0 })
    expect(shapeColors(shape).strokeWidth).toBe(0)
  })

  it('edits shape geometry precisely and makes the text color command affect its outline', () => {
    const shape = createShape(document, 'ellipse')
    shape.style.position = 'absolute'
    shape.style.left = '10px'
    shape.style.top = '20px'
    document.querySelector('section').appendChild(shape)
    runtime.overlay.getSelection = () => [shape]

    setShapeProperties({ x: 31, y: 42, width: 222, height: 111, fill: '#fedcba' })
    expect(selectedShapeInfo()).toMatchObject({ x: 31, y: 42, width: 222, height: 111, fill: '#fedcba' })

    setTextColor('#010203')
    expect(shapeColors(shape).stroke).toBe('#010203')
  })
})
