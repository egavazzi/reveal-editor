import { afterEach, describe, expect, it, vi } from 'vitest'
import { fragmentSteps, renderSlides, slideLayers } from '../../src/client/lib/export.js'
import { runtime } from '../../src/client/stores/editor.svelte.js'

// html-to-image needs a real renderer; the point here is which nodes it is
// handed, in which deck state, and that the deck is put back afterwards.
function mockBridge(slidesHtml, { withBackgrounds = true } = {}) {
  const doc = document.implementation.createHTMLDocument('deck')
  doc.body.innerHTML = `<div class="reveal-viewport"><div class="reveal"><div class="slides">${slidesHtml}</div></div><div class="backgrounds"></div></div>`
  const sections = [...doc.querySelectorAll('.slides > section')]
  if (withBackgrounds) {
    for (const section of sections) {
      const background = doc.createElement('div')
      background.className = 'slide-background'
      doc.querySelector('.backgrounds').appendChild(background)
      section.slideBackgroundElement = background
    }
  }
  const visited = []
  return {
    doc,
    visited,
    slidesEl: doc.querySelector('.slides'),
    getSlideEntries: () => sections.map((section, h) => ({ section, h, v: 0 })),
    getIndex: () => ({ h: 2, v: 1 }),
    config: () => ({ width: 960, height: 700 }),
    goTo: (h, v, f) => visited.push([h, v, f])
  }
}

function mockImaging() {
  return {
    toPng: vi.fn(async (node) => `data:image/png;base64,${node.className || node.tagName}`),
    getFontEmbedCSS: vi.fn(async () => '@font-face{font-family:KaTeX_Main}'),
    composite: vi.fn(async (images) => images.join('|'))
  }
}

afterEach(() => { runtime.bridge = null })

describe('slide layers', () => {
  it('includes the background element reveal.js paints beside the section', () => {
    const bridge = mockBridge('<section></section>')
    const section = bridge.slidesEl.querySelector('section')
    expect(slideLayers(section)).toEqual([section.slideBackgroundElement, section])
  })

  it('is the section alone when the deck has no background elements', () => {
    const bridge = mockBridge('<section></section>', { withBackgrounds: false })
    const section = bridge.slidesEl.querySelector('section')
    expect(slideLayers(section)).toEqual([section])
  })
})

describe('fragment steps', () => {
  it('yields one page per fragment step, starting with nothing revealed', () => {
    const bridge = mockBridge(`<section>
      <p class="fragment" data-fragment-index="0"></p>
      <p class="fragment" data-fragment-index="1"></p>
      <p class="fragment" data-fragment-index="1"></p>
    </section>`)
    expect(fragmentSteps(bridge.slidesEl.querySelector('section'))).toEqual([-1, 0, 1])
  })

  it('leaves a slide without fragments in the state the deck is in', () => {
    const bridge = mockBridge('<section><p>plain</p></section>')
    expect(fragmentSteps(bridge.slidesEl.querySelector('section'))).toEqual([undefined])
  })
})

describe('rasterized export', () => {
  it('captures each slide background under its section and embeds fonts once', async () => {
    runtime.bridge = mockBridge('<section id="a"></section><section id="b"></section>')
    const imaging = mockImaging()
    const { images, width, height } = await renderSlides(imaging)

    expect(width).toBe(960)
    expect(height).toBe(700)
    expect(images).toEqual([
      'data:image/png;base64,slide-background|data:image/png;base64,SECTION',
      'data:image/png;base64,slide-background|data:image/png;base64,SECTION'
    ])
    expect(imaging.getFontEmbedCSS).toHaveBeenCalledTimes(1)
    expect(imaging.toPng).toHaveBeenCalledTimes(4)
    for (const [, options] of imaging.toPng.mock.calls) {
      expect(options.fontEmbedCSS).toBe('@font-face{font-family:KaTeX_Main}')
      expect(options.skipFonts).toBeUndefined()
    }
    // The background layer is filled in; the section above it stays clear.
    expect(imaging.toPng.mock.calls[0][1].backgroundColor).toBe('#fff')
    expect(imaging.toPng.mock.calls[1][1].backgroundColor).toBeUndefined()
  })

  it('renders one image per fragment step', async () => {
    runtime.bridge = mockBridge('<section><p class="fragment" data-fragment-index="0"></p></section>')
    const { images } = await renderSlides(mockImaging())
    expect(images).toHaveLength(2)
    expect(runtime.bridge.visited.slice(0, 2)).toEqual([[0, 0, -1], [0, 0, 0]])
  })

  it('returns the deck to the slide it was on even when a capture fails', async () => {
    runtime.bridge = mockBridge('<section></section>')
    const imaging = mockImaging()
    imaging.toPng = vi.fn(async () => { throw new Error('render exploded') })

    await expect(renderSlides(imaging)).rejects.toThrow('render exploded')
    expect(runtime.bridge.visited.at(-1)).toEqual([2, 1, undefined])
  })
})
