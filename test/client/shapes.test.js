// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import {
  flattenSelectedLine, selectedShapeInfo, setShapeProperties, setTextColor
} from '../../src/client/lib/actions.js'
import {
  ANGLE_SNAP_STEP, constrainSegmentAngle, createShape, setShapeColors, shapeColors, syncShapeGeometry
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

  it('draws a one-pixel-thin box as a dead level segment', () => {
    const line = createShape(document, 'line')
    syncShapeGeometry(line)
    const el = line.querySelector('line')
    expect(el.getAttribute('y1')).toBe(el.getAttribute('y2'))

    line.style.width = '1px'
    line.style.height = '200px'
    syncShapeGeometry(line)
    expect(el.getAttribute('x1')).toBe(el.getAttribute('x2'))
  })

  it('constrains an endpoint to 15° steps, and only near-flat ones otherwise', () => {
    const fixed = { x: 100, y: 100 }
    // 4° off horizontal, dragged with Shift → exactly horizontal, same length
    const stepped = constrainSegmentAngle(fixed, { x: 300, y: 114 }, { step: ANGLE_SNAP_STEP })
    expect(stepped.y).toBeCloseTo(100)
    expect(stepped.x).toBeCloseTo(100 + Math.hypot(200, 14))

    // 40° off horizontal with Shift → nearest 15° step (45°), not flattened
    const diagonal = constrainSegmentAngle(fixed, { x: 200, y: 184 }, { step: ANGLE_SNAP_STEP })
    expect(diagonal.x - fixed.x).toBeCloseTo(diagonal.y - fixed.y)

    // without Shift only a near-flat drag is pulled level
    expect(constrainSegmentAngle(fixed, { x: 300, y: 106 }, { tolerance: 4 }).y).toBeCloseTo(100)
    expect(constrainSegmentAngle(fixed, { x: 300, y: 160 }, { tolerance: 4 })).toEqual({ x: 300, y: 160 })
    // …and nothing moves when snapping is overridden
    expect(constrainSegmentAngle(fixed, { x: 300, y: 106 }, {})).toEqual({ x: 300, y: 106 })
  })

  it('flattens a crooked arrow while keeping its length, centre and direction', () => {
    const arrow = createShape(document, 'arrow')
    arrow.style.position = 'absolute'
    arrow.style.left = '100px'
    arrow.style.top = '100px'
    arrow.style.width = '160px'
    arrow.style.height = '120px'
    arrow.setAttribute('data-re-line-start', 'ne')
    document.querySelector('section').appendChild(arrow)
    runtime.overlay.getSelection = () => [arrow]

    flattenSelectedLine('horizontal')
    // centre stays at (180, 160), length 200 is preserved, box is flat
    expect(selectedShapeInfo()).toMatchObject({ x: 80, y: 160, width: 200, height: 1 })
    // it still points west, as it did before
    expect(arrow.getAttribute('data-re-line-start')).toBe('ne')

    flattenSelectedLine('vertical')
    expect(selectedShapeInfo()).toMatchObject({ x: 180, y: 60, width: 1, height: 200 })
    expect(arrow.getAttribute('data-re-line-start')).toBe('nw')
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
