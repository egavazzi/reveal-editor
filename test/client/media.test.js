// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { videoInfo, applyVideoProperties } from '../../src/client/lib/model/media.js'
import { cleanElementHtml } from '../../src/client/lib/model/clean.js'

function makeVideo(attrs = '') {
  document.body.innerHTML = `
    <section><video class="re-el" src="assets/a.mp4" style="position:absolute; left:10px; top:10px; width:320px; height:180px;" ${attrs}></video></section>`
  return document.querySelector('video')
}

describe('video media properties', () => {
  it('reads playback state from attributes', () => {
    const el = makeVideo('controls loop muted data-autoplay')
    expect(videoInfo(el)).toMatchObject({
      width: 320, height: 180, autoplay: true, loop: true, muted: true, controls: true
    })
    expect(videoInfo(makeVideo())).toMatchObject({
      autoplay: false, loop: false, muted: false, controls: false
    })
  })

  it('writes properties as persistable attributes', () => {
    const el = makeVideo('controls')
    applyVideoProperties(el, { autoplay: true, loop: true, muted: true, controls: false, width: 640, height: 360 })
    expect(el.hasAttribute('data-autoplay')).toBe(true)
    expect(el.hasAttribute('loop')).toBe(true)
    expect(el.hasAttribute('muted')).toBe(true)
    expect(el.hasAttribute('controls')).toBe(false)
    expect(el.style.width).toBe('640px')
    expect(el.style.height).toBe('360px')
    applyVideoProperties(el, { autoplay: false, loop: false, muted: false })
    expect(el.hasAttribute('data-autoplay')).toBe(false)
    expect(el.hasAttribute('loop')).toBe(false)
    expect(el.hasAttribute('muted')).toBe(false)
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
    expect(html).toContain('controls')
  })

  it('strips reveal runtime pause markers on save', () => {
    const el = makeVideo('controls data-paused-by-reveal')
    const html = cleanElementHtml(el.closest('section'))
    expect(html).not.toContain('data-paused-by-reveal')
    expect(html).toContain('controls')
  })
})
