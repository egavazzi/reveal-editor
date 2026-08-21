// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  imageOf, isImageFrame, wrapImage, unwrapImage, removeCrop,
  isTrivialCrop, readRect, writeRect, resizeFrameContents
} from '../../src/client/lib/model/crop.js'
import { cleanElementHtml } from '../../src/client/lib/model/clean.js'

function makeImage(style = '', { natural = null } = {}) {
  document.body.innerHTML = `
    <section><img class="re-el" src="assets/a.png"
      style="position:absolute; left:100px; top:50px; width:400px; height:300px; ${style}"></section>`
  const img = document.querySelector('img')
  if (natural) {
    Object.defineProperty(img, 'naturalWidth', { value: natural.w })
    Object.defineProperty(img, 'naturalHeight', { value: natural.h })
  }
  return img
}

describe('image crop frames', () => {
  it('wraps a plain image into a frame without moving anything', () => {
    const img = makeImage()
    const frame = wrapImage(img)
    expect(isImageFrame(frame)).toBe(true)
    expect(imageOf(frame)).toBe(img)
    expect(readRect(frame)).toEqual({ left: 100, top: 50, width: 400, height: 300 })
    // the picture fills its frame exactly: nothing cropped yet
    expect(readRect(img)).toEqual({ left: 0, top: 0, width: 400, height: 300 })
    expect(isTrivialCrop(frame)).toBe(true)
    // frame took over selection duty
    expect(frame.classList.contains('re-el')).toBe(true)
    expect(img.classList.contains('re-el')).toBe(false)
    expect(frame.style.overflow).toBe('hidden')
    expect(img.style.maxWidth).toBe('none')
  })

  it('converts an object-fit cover crop into equivalent picture geometry', () => {
    const img = makeImage('object-fit: cover; object-position: 100% 50%;', { natural: { w: 100, h: 100 } })
    const frame = wrapImage(img)
    // cover scale for a 400×300 frame over a square picture is 4
    expect(readRect(img)).toEqual({ left: 0, top: -50, width: 400, height: 400 })
    expect(img.style.objectFit).toBe('')
    expect(isTrivialCrop(frame)).toBe(false)
  })

  it('moves decorations to the frame and back', () => {
    const img = makeImage('border: 3px solid rgb(255, 0, 0); border-radius: 8px; box-shadow: 0 0 4px #000; transform: rotate(10deg);')
    const frame = wrapImage(img)
    expect(frame.style.borderRadius).toBe('8px')
    expect(frame.style.transform).toBe('rotate(10deg)')
    expect(img.style.borderRadius).toBe('')
    expect(img.style.transform).toBe('')
    const back = unwrapImage(frame)
    expect(back).toBe(img)
    expect(img.style.borderRadius).toBe('8px')
    expect(img.style.transform).toBe('rotate(10deg)')
    expect(img.classList.contains('re-el')).toBe(true)
    expect(document.querySelector('.re-image-frame')).toBe(null)
  })

  it('parses px object-position offsets as edge distances, not percentages', () => {
    const img = makeImage('object-fit: cover; object-position: 10px 20px;', { natural: { w: 100, h: 100 } })
    wrapImage(img)
    expect(readRect(img)).toEqual({ left: 10, top: 20, width: 400, height: 400 })
  })

  it('resolves keyword object-position values', () => {
    const img = makeImage('object-fit: contain; object-position: right;', { natural: { w: 100, h: 100 } })
    wrapImage(img)
    // contain scale for a 400×300 frame over a square picture is 3;
    // 'right' pins the 300×300 picture to the right edge, y stays centered
    expect(readRect(img)).toEqual({ left: 100, top: 0, width: 300, height: 300 })
  })

  it('keeps a rotated picture in place when the crop is removed', () => {
    const img = makeImage('transform: rotate(90deg);')
    const frame = wrapImage(img)
    writeRect(img, { left: -60, top: -20, width: 400, height: 300 })
    const back = removeCrop(frame)
    expect(back.style.transform).toBe('rotate(90deg)')
    // the restored picture's center must land where the rotated frame
    // rendered it: frame center (300,200) + rotate90(-60,-20) = (320,140)
    const rect = readRect(back)
    expect(rect.left + rect.width / 2).toBeCloseTo(320)
    expect(rect.top + rect.height / 2).toBeCloseTo(140)
  })

  it('crops when the frame shrinks and the picture holds still', () => {
    const img = makeImage()
    const frame = wrapImage(img)
    // crop 60px off the left and 20px off the top
    writeRect(frame, { left: 160, top: 70, width: 340, height: 280 })
    writeRect(img, { left: -60, top: -20, width: 400, height: 300 })
    expect(isTrivialCrop(frame)).toBe(false)
    // removing the crop restores the full picture at its canvas position
    const back = removeCrop(frame)
    expect(readRect(back)).toEqual({ left: 100, top: 50, width: 400, height: 300 })
  })

  it('scales the picture with its frame so a resize keeps the crop', () => {
    const img = makeImage()
    const frame = wrapImage(img)
    writeRect(img, { left: -60, top: -20, width: 400, height: 300 })
    const start = { frame: readRect(frame), img: readRect(img) }
    // frame doubles in width, halves in height
    resizeFrameContents(frame, start, 800, 150)
    expect(readRect(img)).toEqual({ left: -120, top: -10, width: 800, height: 150 })
  })

  it('survives the save cleaner and drops the live crop marker', () => {
    const img = makeImage()
    const frame = wrapImage(img)
    writeRect(img, { left: -60, top: 0, width: 400, height: 300 })
    frame.classList.add('re-cropping')
    const view = document.createElement('div')
    view.className = 're-transient re-crop-view'
    frame.appendChild(view)
    const html = cleanElementHtml(frame.closest('section'))
    expect(html).toContain('re-image-frame')
    expect(html).toContain('overflow: hidden')
    expect(html).toContain('assets/a.png')
    expect(html).not.toContain('re-cropping')
    expect(html).not.toContain('re-crop-view')
  })

  it('leaves non-images alone', () => {
    document.body.innerHTML = '<div class="re-el"></div>'
    const div = document.querySelector('div')
    expect(imageOf(div)).toBe(null)
    expect(isImageFrame(div)).toBe(false)
  })
})
