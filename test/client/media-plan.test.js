// @vitest-environment happy-dom
// Sizing the deck's media for a self-contained export, and driving the
// server encoder over the resulting plan.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EXPORT_OVERSAMPLE, displayedSize, mediaPlan } from '../../src/client/lib/model/media-plan.js'

vi.mock('../../src/client/lib/api.js', () => ({
  exportMediaCopy: vi.fn(),
  clearExportMedia: vi.fn()
}))

const api = await import('../../src/client/lib/api.js')
const { prepareExportMedia } = await import('../../src/client/lib/export-media.js')

function slides(html) {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

function targetOf(plan, path) {
  return plan.find((entry) => entry.path === path)?.target
}

describe('media plan', () => {
  it('asks for twice the size the element is drawn at', () => {
    const plan = mediaPlan({
      slidesEl: slides('<img class="re-el" src="assets/a.png" style="width: 300px; height: 200px">')
    })
    expect(EXPORT_OVERSAMPLE).toBe(2)
    expect(plan).toEqual([{ path: 'assets/a.png', refs: ['assets/a.png'], target: { width: 600, height: 400 } }])
  })

  it('gives a file used at several sizes the largest of them', () => {
    const plan = mediaPlan({
      slidesEl: slides(`
        <section><img src="assets/a.png" style="width: 300px; height: 200px"></section>
        <section><img src="./assets/a.png" style="width: 480px; height: 320px"></section>
        <section><img src="assets/a.png" style="width: 100px; height: 60px"></section>`)
    })
    expect(plan).toHaveLength(1)
    expect(plan[0].refs).toEqual(['assets/a.png', './assets/a.png'])
    expect(plan[0].target).toEqual({ width: 960, height: 640 })
  })

  it('sizes a cropped picture by the picture, not by the frame it shows through', () => {
    const plan = mediaPlan({
      slidesEl: slides(`
        <div class="re-el re-image-frame" style="width: 300px; height: 200px; overflow: hidden">
          <img src="assets/a.png" style="position: absolute; left: -100px; top: 0; width: 900px; height: 600px">
        </div>`)
    })
    expect(targetOf(plan, 'assets/a.png')).toEqual({ width: 1800, height: 1200 })
  })

  it('sizes a slide background by the deck slide size', () => {
    const plan = mediaPlan({
      slidesEl: slides(`
        <section data-background-image="assets/bg.jpg"></section>
        <section data-background-video="assets/one.webm,assets/two.webm"></section>`),
      slideWidth: 960,
      slideHeight: 700
    })
    expect(targetOf(plan, 'assets/bg.jpg')).toEqual({ width: 1920, height: 1400 })
    expect(targetOf(plan, 'assets/two.webm')).toEqual({ width: 1920, height: 1400 })
  })

  it('takes the size of the element that has a box for srcset and <source>', () => {
    const plan = mediaPlan({
      slidesEl: slides(`
        <video style="width: 400px; height: 300px"><source src="assets/clip.webm"></video>
        <img srcset="assets/wide.png 2x, assets/narrow.png 1x" style="width: 200px; height: 100px">
        <div style="width: 50px; height: 40px; background: url('assets/tile.png')"></div>`)
    })
    expect(targetOf(plan, 'assets/clip.webm')).toEqual({ width: 800, height: 600 })
    expect(targetOf(plan, 'assets/wide.png')).toEqual({ width: 400, height: 200 })
    expect(targetOf(plan, 'assets/tile.png')).toEqual({ width: 100, height: 80 })
  })

  it('keeps a file at its own size when a use has no measurable box', () => {
    const plan = mediaPlan({
      slidesEl: slides(`
        <img src="assets/a.png" style="width: 300px; height: 200px">
        <img src="assets/a.png">
        <img src="assets/b.png">`)
    })
    expect(targetOf(plan, 'assets/a.png')).toBe(null)
    expect(targetOf(plan, 'assets/b.png')).toBe(null)
  })

  it('measures an element without an inline size through the reveal scale', () => {
    const slidesEl = slides('<img src="assets/a.png">')
    const img = slidesEl.querySelector('img')
    img.getBoundingClientRect = () => ({ width: 300, height: 150 })
    expect(displayedSize(img, 0.5)).toEqual({ width: 600, height: 300 })
    expect(targetOf(mediaPlan({ slidesEl, scale: 0.5 }), 'assets/a.png'))
      .toEqual({ width: 1200, height: 600 })
  })
})

describe('preparing the export media', () => {
  beforeEach(() => {
    api.exportMediaCopy.mockReset()
  })

  const slidesEl = () => slides(`
    <img src="assets/a.png" style="width: 300px; height: 200px">
    <img src="assets/a.png" style="width: 100px; height: 100px">
    <video src="assets/clip.mp4" style="width: 480px; height: 270px"></video>
    <img src="assets/logo.svg" style="width: 80px; height: 80px">`)

  it('encodes each file once, at its planned size, and maps the copies onto the originals', async () => {
    api.exportMediaCopy.mockImplementation(async (path) => {
      if (path === 'assets/logo.svg') return { skipped: true, before: 500, reason: 'vector image' }
      return { path: `/api/export/media/${path.split('/').pop()}-1234abcd.webm`, before: 1000, after: 400 }
    })
    const progress = []
    const { replacements, summary } = await prepareExportMedia({
      slidesEl: slidesEl(),
      baseUrl: 'http://localhost:3737/deck/deck.html',
      preset: 'near-lossless',
      codec: 'vp9',
      onProgress: (state) => progress.push(state)
    })

    expect(api.exportMediaCopy.mock.calls.map(([path, options]) => [path, options.target])).toEqual([
      ['assets/a.png', { width: 600, height: 400 }],
      ['assets/clip.mp4', { width: 960, height: 540 }],
      ['assets/logo.svg', { width: 160, height: 160 }]
    ])
    expect(api.exportMediaCopy.mock.calls[0][1]).toMatchObject({ preset: 'near-lossless', codec: 'vp9' })
    expect(replacements.get('http://localhost:3737/deck/assets/a.png'))
      .toEqual({ url: '/api/export/media/a.png-1234abcd.webm', video: false })
    expect(replacements.has('http://localhost:3737/deck/assets/logo.svg')).toBe(false)
    expect(summary).toEqual({
      before: 2500,
      after: 1300,
      kept: [{ name: 'logo.svg', reason: 'vector image', ssim: undefined }]
    })
    expect(progress.at(-1)).toEqual({ done: 3, total: 3, label: 'Building the HTML…' })
  })

  it('records a file the encoder would not improve, with the reason', async () => {
    api.exportMediaCopy.mockResolvedValue({ kept: true, before: 900, after: 880, reason: 'ssim below threshold', ssim: 0.94 })
    const { replacements, summary } = await prepareExportMedia({
      slidesEl: slides('<video src="assets/clip.mp4" style="width: 100px; height: 100px"></video>'),
      baseUrl: 'http://localhost:3737/deck/deck.html',
      preset: 'compact',
      codec: 'vp9'
    })
    expect(replacements.size).toBe(0)
    expect(summary).toEqual({ before: 900, after: 900, kept: [{ name: 'clip.mp4', reason: 'ssim below threshold', ssim: 0.94 }] })
  })

  it('fails the export when a file cannot be encoded, naming it', async () => {
    api.exportMediaCopy.mockRejectedValue(new Error('ffmpeg is not installed on this machine'))
    await expect(prepareExportMedia({
      slidesEl: slides('<video src="assets/clip.mp4" style="width: 100px; height: 100px"></video>'),
      baseUrl: 'http://localhost:3737/deck/deck.html',
      preset: 'compact',
      codec: 'vp9'
    })).rejects.toThrow('clip.mp4: ffmpeg is not installed on this machine')
  })
})
