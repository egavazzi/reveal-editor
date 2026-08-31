// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  imageOf, videoOf, mediaOf, isImageFrame, wrapImage, unwrapImage, removeCrop,
  isTrivialCrop, readRect, writeRect, resizeFrameContents
} from '../../src/client/lib/model/crop.js'
import { VIDEO_CONTROLS_ATTR } from '../../src/client/lib/model/videocontrols.js'
import { videoInfo, applyVideoProperties } from '../../src/client/lib/model/media.js'
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
    const start = { frame: readRect(frame), media: readRect(img) }
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

  it('leaves non-media alone', () => {
    document.body.innerHTML = '<div class="re-el"></div>'
    const div = document.querySelector('div')
    expect(mediaOf(div)).toBe(null)
    expect(imageOf(div)).toBe(null)
    expect(isImageFrame(div)).toBe(false)
  })
})

function makeVideo(style = '', { intrinsic = null, attrs = '' } = {}) {
  document.body.innerHTML = `
    <section><video class="re-el" src="assets/a.webm" ${attrs}
      style="position:absolute; left:100px; top:50px; width:400px; height:300px; ${style}"></video></section>`
  const video = document.querySelector('video')
  if (intrinsic) {
    Object.defineProperty(video, 'videoWidth', { value: intrinsic.w })
    Object.defineProperty(video, 'videoHeight', { value: intrinsic.h })
  }
  return video
}

describe('video crop frames', () => {
  it('wraps a video into a frame the same way as an image', () => {
    const video = makeVideo()
    const frame = wrapImage(video)
    expect(isImageFrame(frame)).toBe(true)
    expect(mediaOf(frame)).toBe(video)
    expect(videoOf(frame)).toBe(video)
    // a video frame is not an image frame: the panels must not confuse them
    expect(imageOf(frame)).toBe(null)
    expect(readRect(frame)).toEqual({ left: 100, top: 50, width: 400, height: 300 })
    expect(readRect(video)).toEqual({ left: 0, top: 0, width: 400, height: 300 })
    expect(isTrivialCrop(frame)).toBe(true)
    expect(frame.classList.contains('re-el')).toBe(true)
    expect(video.classList.contains('re-el')).toBe(false)
    expect(frame.style.overflow).toBe('hidden')
    expect(video.style.maxWidth).toBe('none')
  })

  it('converts an object-fit cover crop using the video\'s intrinsic size', () => {
    const video = makeVideo('object-fit: cover; object-position: 100% 50%;', { intrinsic: { w: 100, h: 100 } })
    const frame = wrapImage(video)
    // cover scale for a 400×300 frame over a square picture is 4
    expect(readRect(video)).toEqual({ left: 0, top: -50, width: 400, height: 400 })
    expect(video.style.objectFit).toBe('')
    expect(isTrivialCrop(frame)).toBe(false)
  })

  it('keeps playback attributes on the video and decorations on the frame', () => {
    const video = makeVideo('border-radius: 8px; box-shadow: 0 0 4px #000;',
      { attrs: 'loop muted data-autoplay' })
    const frame = wrapImage(video)
    for (const attr of ['loop', 'muted', 'data-autoplay']) {
      expect(video.hasAttribute(attr)).toBe(true)
      expect(frame.hasAttribute(attr)).toBe(false)
    }
    expect(frame.style.borderRadius).toBe('8px')
    expect(video.style.borderRadius).toBe('')
    expect(unwrapImage(frame)).toBe(video)
    expect(video.style.borderRadius).toBe('8px')
  })

  it('hands native controls over to the runtime bar while framed', () => {
    const video = makeVideo('', { attrs: 'controls' })
    const frame = wrapImage(video)
    // native controls are drawn on the video's own box, which the frame clips
    expect(video.hasAttribute('controls')).toBe(false)
    expect(video.hasAttribute(VIDEO_CONTROLS_ATTR)).toBe(true)
    expect(videoInfo(frame).controls).toBe(true)
    unwrapImage(frame)
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.hasAttribute(VIDEO_CONTROLS_ATTR)).toBe(false)
  })

  it('leaves a video without controls alone on both sides of a crop', () => {
    const video = makeVideo()
    const frame = wrapImage(video)
    expect(video.hasAttribute(VIDEO_CONTROLS_ATTR)).toBe(false)
    expect(videoInfo(frame).controls).toBe(false)
    // the panel checkbox writes whichever attribute the current framing uses
    applyVideoProperties(frame, { controls: true })
    expect(video.hasAttribute(VIDEO_CONTROLS_ATTR)).toBe(true)
    expect(video.hasAttribute('controls')).toBe(false)
    applyVideoProperties(frame, { controls: false })
    expect(video.hasAttribute(VIDEO_CONTROLS_ATTR)).toBe(false)
    unwrapImage(frame)
    expect(video.hasAttribute('controls')).toBe(false)
  })

  it('restores the full video when the crop is removed', () => {
    const video = makeVideo()
    const frame = wrapImage(video)
    writeRect(frame, { left: 160, top: 70, width: 340, height: 280 })
    writeRect(video, { left: -60, top: -20, width: 400, height: 300 })
    expect(isTrivialCrop(frame)).toBe(false)
    const back = removeCrop(frame)
    expect(back).toBe(video)
    expect(readRect(back)).toEqual({ left: 100, top: 50, width: 400, height: 300 })
  })

  it('scales the video with its frame so a resize keeps the crop', () => {
    const video = makeVideo()
    const frame = wrapImage(video)
    writeRect(video, { left: -60, top: -20, width: 400, height: 300 })
    const start = { frame: readRect(frame), media: readRect(video) }
    resizeFrameContents(frame, start, 800, 150)
    expect(readRect(video)).toEqual({ left: -120, top: -10, width: 800, height: 150 })
  })

  it('reports and edits a cropped video through its frame', () => {
    const video = makeVideo('', { attrs: 'controls' })
    const frame = wrapImage(video)
    writeRect(video, { left: -60, top: -20, width: 400, height: 300 })
    const info = videoInfo(frame)
    expect(info.el).toBe(frame)
    expect(info.media).toBe(video)
    expect(info.cropped).toBe(true)
    expect(info.controls).toBe(true)
    expect(info.width).toBe(400)
    // resizing through the panel scales the picture with the frame
    applyVideoProperties(frame, { width: 800, loop: true })
    expect(readRect(frame).width).toBe(800)
    expect(readRect(video)).toEqual({ left: -120, top: -20, width: 800, height: 300 })
    expect(video.hasAttribute('loop')).toBe(true)
    expect(frame.hasAttribute('loop')).toBe(false)
  })

  it('saves the marker and the bare frame, never the runtime bar', () => {
    const video = makeVideo('', { attrs: 'controls' })
    const frame = wrapImage(video)
    writeRect(video, { left: -60, top: 0, width: 400, height: 300 })
    // the state crop mode and the control-bar runtime leave behind
    frame.classList.add('re-cropping')
    const view = document.createElement('div')
    view.className = 're-transient re-crop-view'
    frame.appendChild(view)
    const bar = document.createElement('div')
    bar.className = 're-transient re-video-controls'
    frame.appendChild(bar)
    const html = cleanElementHtml(frame.closest('section'))
    expect(html).toContain('re-image-frame')
    expect(html).toContain('assets/a.webm')
    expect(html).toContain(VIDEO_CONTROLS_ATTR)
    // a framed video must not ask the browser for controls it would clip away
    expect(html).not.toMatch(/\scontrols/)
    expect(html).not.toContain('re-video-controls')
    expect(html).not.toContain('re-cropping')
    expect(html).not.toContain('re-crop-view')
  })
})
