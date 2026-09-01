// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VIDEO_AUTOPLAY_SCRIPT, VIDEO_DELAY_ATTR } from '../../src/client/lib/model/videocontrols.js'

// A deck of two slides, the second holding a video that starts late.
function makeDeck(delay = '2') {
  document.body.innerHTML = `
    <div class="reveal"><div class="slides">
      <section id="first"><p>One</p></section>
      <section id="second">
        <video id="late" src="clip.webm" ${VIDEO_DELAY_ATTR}="${delay}"></video>
      </section>
    </div></div>`
  const video = document.getElementById('late')
  const calls = { play: 0, pause: 0 }
  video.play = () => { calls.play++; return Promise.resolve() }
  video.pause = () => { calls.pause++ }
  return { video, calls }
}

// Just enough of reveal's API for the runtime: the current slide and the two
// events it listens on.
function fakeReveal(startSlide) {
  const handlers = {}
  let current = startSlide
  window.Reveal = {
    on: (type, fn) => { (handlers[type] ||= []).push(fn) },
    getCurrentSlide: () => current,
    isReady: () => true
  }
  return {
    emit: (type) => { for (const fn of handlers[type] || []) fn() },
    goTo: (slide) => {
      current = slide
      for (const fn of handlers.slidechanged || []) fn()
    }
  }
}

// The saved deck runs this source from its own script node on window load.
function runRuntime() {
  new Function(VIDEO_AUTOPLAY_SCRIPT)()
  window.dispatchEvent(new Event('load'))
  vi.advanceTimersByTime(1)
}

describe('delayed autoplay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    delete window.Reveal
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts the video once the delay has passed on its slide', () => {
    const { video, calls } = makeDeck('2')
    const reveal = fakeReveal(document.getElementById('second'))
    runRuntime()

    // armed on entry, and rewound so a revisit starts from the top
    expect(calls.play).toBe(0)
    expect(video.currentTime).toBe(0)
    vi.advanceTimersByTime(1900)
    expect(calls.play).toBe(0)
    vi.advanceTimersByTime(200)
    expect(calls.play).toBe(1)

    // every visit starts the countdown again
    reveal.goTo(document.getElementById('first'))
    reveal.goTo(document.getElementById('second'))
    vi.advanceTimersByTime(2100)
    expect(calls.play).toBe(2)
  })

  it('drops a pending start when the slide changes first', () => {
    const { calls } = makeDeck('5')
    const reveal = fakeReveal(document.getElementById('second'))
    runRuntime()

    vi.advanceTimersByTime(1000)
    reveal.goTo(document.getElementById('first'))
    vi.advanceTimersByTime(10000)
    expect(calls.play).toBe(0)
  })

  it('arms nothing for a slide without a delayed video', () => {
    const { calls } = makeDeck('2')
    fakeReveal(document.getElementById('first'))
    runRuntime()
    vi.advanceTimersByTime(10000)
    expect(calls.play).toBe(0)
  })

  it('waits for reveal when the deck is still initializing', () => {
    const { calls } = makeDeck('1')
    const reveal = fakeReveal(document.getElementById('second'))
    window.Reveal.isReady = () => false
    runRuntime()
    vi.advanceTimersByTime(5000)
    expect(calls.play).toBe(0)

    reveal.emit('ready')
    vi.advanceTimersByTime(1100)
    expect(calls.play).toBe(1)
  })

  it('reports a blocked start instead of retrying', async () => {
    const { video, calls } = makeDeck('1')
    fakeReveal(document.getElementById('second'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    video.play = () => { calls.play++; return Promise.reject(new Error('NotAllowedError')) }
    runRuntime()

    vi.advanceTimersByTime(1100)
    await Promise.resolve()
    expect(calls.play).toBe(1)
    expect(warn).toHaveBeenCalled()
    // a rejection is reported once, never retried
    vi.advanceTimersByTime(10000)
    expect(calls.play).toBe(1)
    warn.mockRestore()
  })

  it('leaves the edit canvas alone', () => {
    const { calls } = makeDeck('1')
    fakeReveal(document.getElementById('second'))
    // the editor loads the deck with this query, and never presents it
    window.happyDOM.setURL('http://localhost:1234/deck.html?editmode=1')
    runRuntime()
    vi.advanceTimersByTime(10000)
    expect(calls.play).toBe(0)
    window.happyDOM.setURL('http://localhost:1234/deck.html')
  })
})
