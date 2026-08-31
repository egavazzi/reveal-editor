// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VIDEO_CONTROLS_ATTR, VIDEO_CONTROLS_SCRIPT, installVideoControls
} from '../../src/client/lib/model/videocontrols.js'
import { wrapImage, unwrapImage } from '../../src/client/lib/model/crop.js'
import { cleanElementHtml } from '../../src/client/lib/model/clean.js'

function makeDeck({
  attrs = VIDEO_CONTROLS_ATTR,
  frame: frameBox = 'width:340px; height:200px',
  picture = 'left:-60px; top:-20px; width:400px; height:300px',
  intrinsic = null,
  cropped = true
} = {}) {
  document.head.innerHTML = ''
  const media = `<video src="assets/a.webm" ${attrs} style="position:absolute; ${picture}"></video>`
  document.body.innerHTML = `
    <div class="reveal"><div class="slides"><section>
      ${cropped
        ? `<div class="re-el re-image-frame" style="position:absolute; ${frameBox}; overflow:hidden">${media}</div>`
        : media}
    </section></div></div>`
  const video = document.querySelector('video')
  // happy-dom's media element has no real pipeline; the bar only needs the
  // playback surface it drives
  video.play = () => Promise.resolve()
  video.pause = () => {}
  if (intrinsic) {
    Object.defineProperty(video, 'videoWidth', { value: intrinsic.w })
    Object.defineProperty(video, 'videoHeight', { value: intrinsic.h })
  }
  return { frame: document.querySelector('.re-image-frame'), video }
}

/** Put the element into the playing state the bar reads and reacts to. */
function play(video) {
  Object.defineProperty(video, 'paused', { value: false, configurable: true })
  video.dispatchEvent(new Event('play'))
}

// happy-dom lays nothing out, and the runtime decides hover from the boxes on
// screen: stand in for layout with the inline geometry the deck carries.
const BAR_HEIGHT = 28
function rectOf(el) {
  let left = 0
  let top = 0
  for (let node = el; node && node.style; node = node.parentElement) {
    left += parseFloat(node.style.left) || 0
    top += parseFloat(node.style.top) || 0
  }
  const width = parseFloat(el.style.width) || 0
  const height = parseFloat(el.style.height) ||
    (el.classList.contains('re-video-controls') ? BAR_HEIGHT : 0)
  return { left, top, right: left + width, bottom: top + height, width, height }
}

Element.prototype.getBoundingClientRect = function () { return rectOf(this) }

/** Move the pointer to a viewport point, as a browser reports it. */
function pointerAt(x, y) {
  document.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
}

// The saved deck runs this source from its own script node; here it stands in
// for that document-level execution.
function runRuntime() {
  new Function(VIDEO_CONTROLS_SCRIPT)()
  return window.__reVideoControls
}

describe('cropped video controls', () => {
  beforeEach(() => {
    delete window.__reVideoControls
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds a bar in every frame whose video is marked', () => {
    const { frame } = makeDeck()
    runRuntime()
    const bar = frame.querySelector(':scope > .re-video-controls')
    expect(bar).not.toBeNull()
    // anchored to the frame, so the picture's offset and zoom cannot clip it
    expect(bar.parentElement).toBe(frame)
    expect(bar.querySelectorAll('button')).toHaveLength(2)
    expect(bar.querySelector('input[type="range"]')).not.toBeNull()
    expect(bar.querySelector('.re-vc-time').textContent).toBe('0:00 / 0:00')
  })

  it('migrates a native controls attribute to the marker', () => {
    const { frame, video } = makeDeck({ attrs: 'controls' })
    runRuntime()
    expect(video.hasAttribute('controls')).toBe(false)
    expect(video.hasAttribute(VIDEO_CONTROLS_ATTR)).toBe(true)
    expect(frame.querySelector('.re-video-controls')).not.toBeNull()
  })

  it('leaves a video without controls bare', () => {
    const { frame } = makeDeck({ attrs: '' })
    runRuntime()
    expect(frame.querySelector('.re-video-controls')).toBeNull()
  })

  it('syncs without churn and drops a bar whose marker is gone', () => {
    const { frame, video } = makeDeck()
    const api = runRuntime()
    const bar = frame.querySelector('.re-video-controls')
    api.sync()
    expect(frame.querySelectorAll('.re-video-controls')).toHaveLength(1)
    expect(frame.querySelector('.re-video-controls')).toBe(bar)

    video.removeAttribute(VIDEO_CONTROLS_ATTR)
    api.sync()
    expect(frame.querySelector('.re-video-controls')).toBeNull()
  })

  it('plays, pauses and mutes through the bar', () => {
    const { frame, video } = makeDeck()
    runRuntime()
    const bar = frame.querySelector('.re-video-controls')
    const [playButton, mute] = bar.querySelectorAll('button')
    pointerAt(50, 50)
    expect(bar.hasAttribute('data-show')).toBe(true)
    expect(playButton.title).toBe('Play')

    let played = false
    video.play = () => { played = true; return Promise.resolve() }
    playButton.click()
    expect(played).toBe(true)
    // a pointer press leaves no focus behind to pin the bar open
    expect(frame.ownerDocument.activeElement).not.toBe(playButton)

    mute.click()
    expect(video.muted).toBe(true)
    // the bar repaints from the media element's own events
    video.dispatchEvent(new Event('volumechange'))
    expect(mute.title).toBe('Unmute')
  })

  it('shows under the pointer and hides the moment it moves off', () => {
    vi.useFakeTimers()
    const { frame, video } = makeDeck()
    runRuntime()
    const bar = frame.querySelector('.re-video-controls')
    // nothing has been touched yet
    expect(bar.hasAttribute('data-show')).toBe(false)
    vi.advanceTimersByTime(10000)
    expect(bar.hasAttribute('data-show')).toBe(false)

    pointerAt(50, 50)
    expect(bar.hasAttribute('data-show')).toBe(true)
    // a paused video keeps the bar for as long as the pointer stays
    vi.advanceTimersByTime(10000)
    expect(bar.hasAttribute('data-show')).toBe(true)

    // out sideways: the frame is 340×200 at the slide's origin
    pointerAt(600, 50)
    expect(bar.hasAttribute('data-show')).toBe(false)
    expect(frame.hasAttribute('data-re-idle')).toBe(false)

    // playing and ended behave no differently: the pointer decides
    pointerAt(50, 50)
    play(video)
    pointerAt(600, 50)
    expect(bar.hasAttribute('data-show')).toBe(false)
    video.dispatchEvent(new Event('ended'))
    expect(bar.hasAttribute('data-show')).toBe(false)
  })

  it('keeps the bar while the pointer is on it, over or beside the picture', () => {
    const { video } = makeDeck({
      cropped: false,
      picture: 'left:100px; top:50px; width:400px; height:300px'
    })
    runRuntime()
    const bar = video.nextElementSibling
    // the bar overlays the picture's bottom: 400 wide at x=100, y 310–338
    pointerAt(300, 100)
    expect(bar.hasAttribute('data-show')).toBe(true)
    // crossing onto the bar is not leaving the picture
    pointerAt(300, 320)
    expect(bar.hasAttribute('data-show')).toBe(true)
    // leaving downward through the bar is, and takes effect at once
    pointerAt(300, 400)
    expect(bar.hasAttribute('data-show')).toBe(false)

    // a bar hanging below a short picture still counts as hover
    pointerAt(300, 200)
    expect(bar.hasAttribute('data-show')).toBe(true)
    pointerAt(50, 200)
    expect(bar.hasAttribute('data-show')).toBe(false)
  })

  it('fades out over a playing video the pointer rests on', () => {
    vi.useFakeTimers()
    const { frame, video } = makeDeck()
    runRuntime()
    const bar = frame.querySelector('.re-video-controls')
    pointerAt(50, 50)
    play(video)

    vi.advanceTimersByTime(2400)
    expect(bar.hasAttribute('data-show')).toBe(true)
    vi.advanceTimersByTime(200)
    expect(bar.hasAttribute('data-show')).toBe(false)
    // the cursor goes with it, over footage nobody is touching
    expect(frame.hasAttribute('data-re-idle')).toBe(true)

    pointerAt(60, 50)
    expect(bar.hasAttribute('data-show')).toBe(true)
    expect(frame.hasAttribute('data-re-idle')).toBe(false)
    // the move restarted the countdown rather than shortening it
    vi.advanceTimersByTime(2400)
    expect(bar.hasAttribute('data-show')).toBe(true)
    vi.advanceTimersByTime(200)
    expect(bar.hasAttribute('data-show')).toBe(false)
  })

  it('never saves the idle marker the hidden cursor needs', () => {
    vi.useFakeTimers()
    const { frame, video } = makeDeck()
    runRuntime()
    pointerAt(50, 50)
    play(video)
    vi.advanceTimersByTime(2600)
    expect(frame.hasAttribute('data-re-idle')).toBe(true)
    expect(cleanElementHtml(frame.closest('section'))).not.toContain('data-re-idle')
  })

  it('toggles playback when the picture itself is clicked', () => {
    const { frame, video } = makeDeck()
    runRuntime()
    let played = 0
    video.play = () => { played++; return Promise.resolve() }

    frame.dispatchEvent(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, bubbles: true }))
    frame.dispatchEvent(new MouseEvent('click', { clientX: 41, clientY: 40, bubbles: true }))
    expect(played).toBe(1)

    // a click that ends a drag moved the element, it did not press the picture
    frame.dispatchEvent(new MouseEvent('pointerdown', { clientX: 40, clientY: 40, bubbles: true }))
    frame.dispatchEvent(new MouseEvent('click', { clientX: 90, clientY: 40, bubbles: true }))
    expect(played).toBe(1)

    // the bar's own controls are not the picture
    const bar = frame.querySelector('.re-video-controls')
    bar.querySelector('.re-vc-time').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(played).toBe(1)
  })

  it('leaves canvas clicks to the editor until Ctrl is held', () => {
    const { frame, video } = makeDeck()
    document.body.classList.add('re-edit-mode')
    runRuntime()
    let played = 0
    video.play = () => { played++; return Promise.resolve() }

    frame.dispatchEvent(new MouseEvent('click', { clientX: 40, clientY: 40, bubbles: true }))
    expect(played).toBe(0)

    // Ctrl hands the pointer to the player, as it does for playback itself
    document.body.classList.add('re-media-live')
    frame.dispatchEvent(new MouseEvent('click', { clientX: 40, clientY: 40, bubbles: true }))
    expect(played).toBe(1)
    document.body.classList.remove('re-edit-mode', 're-media-live')
  })

  it('never reaches the saved deck', () => {
    const { frame } = makeDeck()
    runRuntime()
    const html = cleanElementHtml(frame.closest('section'))
    expect(html).toContain(VIDEO_CONTROLS_ATTR)
    expect(html).not.toContain('re-video-controls')
  })

  // the bar is 28px tall and sits 12px above the picture's bottom edge
  it('spans the picture, not the frame', () => {
    // picture fills its frame: the bar spans the whole bottom edge
    {
      const { frame } = makeDeck({
        frame: 'width:400px; height:300px',
        picture: 'left:0px; top:0px; width:400px; height:300px',
        intrinsic: { w: 800, h: 600 }
      })
      runRuntime()
      const bar = frame.querySelector('.re-video-controls')
      expect(bar.style.left).toBe('0px')
      expect(bar.style.width).toBe('400px')
      expect(bar.style.top).toBe('260px')
    }
    // picture smaller than its frame: the bar sits on the picture's edges
    {
      const { frame } = makeDeck({
        frame: 'width:400px; height:300px',
        picture: 'left:20px; top:10px; width:200px; height:100px',
        intrinsic: { w: 400, h: 200 }
      })
      runRuntime()
      const bar = frame.querySelector('.re-video-controls')
      expect(bar.style.left).toBe('20px')
      expect(bar.style.width).toBe('200px')
      expect(bar.style.top).toBe('70px')
    }
    // cropped on the left: the bar starts at the frame, ends with the picture
    {
      const { frame } = makeDeck({
        frame: 'width:400px; height:300px',
        picture: 'left:-100px; top:0px; width:300px; height:300px',
        intrinsic: { w: 300, h: 300 }
      })
      runRuntime()
      const bar = frame.querySelector('.re-video-controls')
      expect(bar.style.left).toBe('0px')
      expect(bar.style.width).toBe('200px')
      expect(bar.style.top).toBe('260px')
    }
  })

  it('follows the letterbox a mismatched aspect ratio leaves', () => {
    // a square picture in a 400×300 box is drawn 300×300, centered
    const { frame } = makeDeck({
      frame: 'width:400px; height:300px',
      picture: 'left:0px; top:0px; width:400px; height:300px',
      intrinsic: { w: 100, h: 100 }
    })
    runRuntime()
    const bar = frame.querySelector('.re-video-controls')
    expect(bar.style.left).toBe('50px')
    expect(bar.style.width).toBe('300px')
    expect(bar.style.top).toBe('260px')
  })

  it('spans the frame when the visible sliver is too narrow to hold controls', () => {
    const { frame } = makeDeck({
      frame: 'width:400px; height:300px',
      picture: 'left:-390px; top:0px; width:400px; height:300px',
      intrinsic: { w: 400, h: 300 }
    })
    runRuntime()
    const bar = frame.querySelector('.re-video-controls')
    expect(bar.style.left).toBe('0px')
    expect(bar.style.width).toBe('400px')
    expect(bar.style.top).toBe('260px')
  })

  it('repositions the bar when the crop is adjusted', () => {
    const { frame, video } = makeDeck({
      frame: 'width:400px; height:300px',
      picture: 'left:0px; top:0px; width:400px; height:300px',
      intrinsic: { w: 400, h: 300 }
    })
    const api = runRuntime()
    const bar = frame.querySelector('.re-video-controls')
    expect(bar.style.width).toBe('400px')

    video.style.left = '100px'
    video.style.width = '200px'
    video.style.height = '150px'
    api.sync()
    expect(bar.style.left).toBe('100px')
    expect(bar.style.width).toBe('200px')
    expect(bar.style.top).toBe('110px')
  })

  it('serves an uncropped video from a sibling over its picture', () => {
    const { video } = makeDeck({
      cropped: false,
      picture: 'left:100px; top:50px; width:400px; height:300px',
      intrinsic: { w: 400, h: 300 }
    })
    const api = runRuntime()
    const bar = video.nextElementSibling
    expect(bar.classList.contains('re-video-controls')).toBe(true)
    // no frame to live in: the bar is the video's sibling in the slide
    expect(bar.parentElement).toBe(video.parentElement)
    expect(bar.style.left).toBe('100px')
    expect(bar.style.width).toBe('400px')
    expect(bar.style.top).toBe('310px')

    // moving the video takes the bar with it
    video.style.left = '200px'
    video.style.top = '0px'
    api.sync()
    expect(bar.style.left).toBe('200px')
    expect(bar.style.top).toBe('260px')
    expect(cleanElementHtml(video.closest('section'))).not.toContain('re-video-controls')
  })

  it('keeps an uncropped letterboxed video\'s bar on the picture', () => {
    const { video } = makeDeck({
      cropped: false,
      picture: 'left:0px; top:0px; width:400px; height:300px',
      intrinsic: { w: 100, h: 100 }
    })
    runRuntime()
    const bar = video.nextElementSibling
    expect(bar.style.left).toBe('50px')
    expect(bar.style.width).toBe('300px')
    expect(bar.style.top).toBe('260px')
  })

  it('installs its editor copy exactly once', () => {
    makeDeck()
    installVideoControls(document)
    installVideoControls(document)
    expect(document.querySelectorAll('script#re-video-controls-runtime')).toHaveLength(1)
  })

  it('moves the bar into the frame with the video, and back out', () => {
    const { video } = makeDeck({
      cropped: false,
      picture: 'left:0px; top:0px; width:400px; height:300px'
    })
    const section = video.closest('section')
    const api = runRuntime()
    expect(video.nextElementSibling.classList.contains('re-video-controls')).toBe(true)

    const frame = wrapImage(video)
    api.sync()
    expect(frame.querySelector(':scope > .re-video-controls')).not.toBeNull()
    expect(section.querySelectorAll('.re-video-controls')).toHaveLength(1)

    unwrapImage(frame)
    api.sync()
    expect(video.nextElementSibling.classList.contains('re-video-controls')).toBe(true)
    expect(section.querySelectorAll('.re-video-controls')).toHaveLength(1)
  })
})
