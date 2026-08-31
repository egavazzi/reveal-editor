// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  VIDEO_CONTROLS_ATTR, VIDEO_CONTROLS_SCRIPT, installVideoControls
} from '../../src/client/lib/model/videocontrols.js'
import { wrapImage, unwrapImage } from '../../src/client/lib/model/crop.js'
import { cleanElementHtml } from '../../src/client/lib/model/clean.js'

function makeDeck(attrs = `${VIDEO_CONTROLS_ATTR}`) {
  document.head.innerHTML = ''
  document.body.innerHTML = `
    <div class="reveal"><div class="slides"><section>
      <div class="re-el re-image-frame" style="position:absolute; width:340px; height:200px; overflow:hidden">
        <video src="assets/a.webm" ${attrs}
          style="position:absolute; left:-60px; top:-20px; width:400px; height:300px"></video>
      </div>
    </section></div></div>`
  const video = document.querySelector('video')
  // happy-dom's media element has no real pipeline; the bar only needs the
  // playback surface it drives
  video.play = () => Promise.resolve()
  video.pause = () => {}
  return { frame: document.querySelector('.re-image-frame'), video }
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

  it('leaves an unmarked video to the browser\'s own player', () => {
    const { frame } = makeDeck('controls')
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
    const [play, mute] = bar.querySelectorAll('button')
    // paused: the bar stays visible and offers Play
    expect(bar.hasAttribute('data-paused')).toBe(true)
    expect(play.title).toBe('Play')

    let played = false
    video.play = () => { played = true; return Promise.resolve() }
    play.click()
    expect(played).toBe(true)

    mute.click()
    expect(video.muted).toBe(true)
    // the bar repaints from the media element's own events
    video.dispatchEvent(new Event('volumechange'))
    expect(mute.title).toBe('Unmute')
  })

  it('never reaches the saved deck', () => {
    const { frame } = makeDeck()
    runRuntime()
    const html = cleanElementHtml(frame.closest('section'))
    expect(html).toContain(VIDEO_CONTROLS_ATTR)
    expect(html).not.toContain('re-video-controls')
  })

  it('installs its editor copy exactly once', () => {
    makeDeck()
    installVideoControls(document)
    installVideoControls(document)
    expect(document.querySelectorAll('script#re-video-controls-runtime')).toHaveLength(1)
  })

  it('marks and unmarks the video as a crop comes and goes', () => {
    document.body.innerHTML = `
      <div class="reveal"><div class="slides"><section>
        <video class="re-el" src="assets/a.webm" controls
          style="position:absolute; left:0px; top:0px; width:400px; height:300px"></video>
      </section></div></div>`
    const video = document.querySelector('video')
    const frame = wrapImage(video)
    expect(video.hasAttribute('controls')).toBe(false)
    runRuntime()
    expect(frame.querySelector('.re-video-controls')).not.toBeNull()

    unwrapImage(frame)
    expect(video.hasAttribute('controls')).toBe(true)
    expect(document.querySelector('.re-video-controls')).toBeNull()
  })
})
