// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { videoInfo, applyVideoProperties } from '../../src/client/lib/model/media.js'
import { VIDEO_CONTROLS_ATTR, VIDEO_DELAY_ATTR } from '../../src/client/lib/model/videocontrols.js'
import { cleanElementHtml } from '../../src/client/lib/model/clean.js'

function makeVideo(attrs = '') {
  document.body.innerHTML = `
    <section><video class="re-el" src="assets/a.mp4" style="position:absolute; left:10px; top:10px; width:320px; height:180px;" ${attrs}></video></section>`
  return document.querySelector('video')
}

describe('video media properties', () => {
  it('reads playback state from attributes', () => {
    const el = makeVideo(`${VIDEO_CONTROLS_ATTR} loop muted data-autoplay`)
    expect(videoInfo(el)).toMatchObject({
      width: 320, height: 180, autoplay: true, loop: true, muted: true, controls: true
    })
    expect(videoInfo(makeVideo())).toMatchObject({
      autoplay: false, loop: false, muted: false, controls: false
    })
  })

  it('writes properties as persistable attributes', () => {
    const el = makeVideo(VIDEO_CONTROLS_ATTR)
    applyVideoProperties(el, { autoplay: true, loop: true, muted: true, controls: false, width: 640, height: 360 })
    expect(el.hasAttribute('data-autoplay')).toBe(true)
    expect(el.hasAttribute('loop')).toBe(true)
    expect(el.hasAttribute('muted')).toBe(true)
    expect(el.hasAttribute(VIDEO_CONTROLS_ATTR)).toBe(false)
    expect(el.style.width).toBe('640px')
    expect(el.style.height).toBe('360px')
    applyVideoProperties(el, { autoplay: false, loop: false, muted: false })
    expect(el.hasAttribute('data-autoplay')).toBe(false)
    expect(el.hasAttribute('loop')).toBe(false)
    expect(el.hasAttribute('muted')).toBe(false)
  })

  it('records a start delay in place of reveal\'s immediate autoplay', () => {
    const el = makeVideo()
    applyVideoProperties(el, { autoplay: true })
    expect(el.hasAttribute('data-autoplay')).toBe(true)
    expect(videoInfo(el)).toMatchObject({ autoplay: true, autoplayDelay: 0 })

    // reveal starts a data-autoplay video the moment the slide opens, so a
    // delayed one must not carry it
    applyVideoProperties(el, { autoplayDelay: 2.5 })
    expect(el.getAttribute(VIDEO_DELAY_ATTR)).toBe('2.5')
    expect(el.hasAttribute('data-autoplay')).toBe(false)
    expect(videoInfo(el)).toMatchObject({ autoplay: true, autoplayDelay: 2.5 })

    // back to zero: immediate autoplay again
    applyVideoProperties(el, { autoplayDelay: 0 })
    expect(el.hasAttribute(VIDEO_DELAY_ATTR)).toBe(false)
    expect(el.hasAttribute('data-autoplay')).toBe(true)

    // turning autoplay off clears both spellings
    applyVideoProperties(el, { autoplayDelay: 3 })
    applyVideoProperties(el, { autoplay: false })
    expect(el.hasAttribute(VIDEO_DELAY_ATTR)).toBe(false)
    expect(el.hasAttribute('data-autoplay')).toBe(false)
    expect(videoInfo(el)).toMatchObject({ autoplay: false, autoplayDelay: 0 })
  })

  it('saves the start delay', () => {
    const el = makeVideo()
    applyVideoProperties(el, { autoplay: true, autoplayDelay: 1.5 })
    expect(cleanElementHtml(el.closest('section'))).toContain(`${VIDEO_DELAY_ATTR}="1.5"`)
  })

  it('rejects non-video elements', () => {
    document.body.innerHTML = '<div></div>'
    expect(videoInfo(document.querySelector('div'))).toBe(null)
    expect(applyVideoProperties(document.querySelector('div'), { loop: true })).toBe(false)
  })

  it('survives the save cleaner round-trip', () => {
    const el = makeVideo()
    applyVideoProperties(el, { autoplay: true, loop: true, muted: true, controls: true })
    const html = cleanElementHtml(el.closest('section'))
    expect(html).toContain('data-autoplay')
    expect(html).toContain('loop')
    expect(html).toContain('muted')
    // the deck records controls as the marker the runtime draws its bar from
    expect(html).toContain(VIDEO_CONTROLS_ATTR)
  })

  it('strips reveal runtime pause markers on save', () => {
    const el = makeVideo(`${VIDEO_CONTROLS_ATTR} data-paused-by-reveal`)
    const html = cleanElementHtml(el.closest('section'))
    expect(html).not.toContain('data-paused-by-reveal')
    expect(html).toContain(VIDEO_CONTROLS_ATTR)
  })
})
