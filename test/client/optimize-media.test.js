// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'

const api = vi.hoisted(() => ({
  optimizeAsset: vi.fn(),
  deleteAsset: vi.fn(async () => ({ ok: true })),
  fetchDeck: vi.fn()
}))
const actions = vi.hoisted(() => ({ snapshotDeck: vi.fn(), markDirty: vi.fn() }))
const save = vi.hoisted(() => ({ saveDeck: vi.fn(async () => { editor.dirty = false }) }))

vi.mock('../../src/client/lib/api.js', () => api)
vi.mock('../../src/client/lib/actions.js', () => actions)
vi.mock('../../src/client/lib/model/save.js', () => save)

const { optimizeDeckMedia } = await import('../../src/client/lib/optimize-media.js')

function setSlides(html) {
  const slidesEl = document.createElement('div')
  slidesEl.innerHTML = html
  runtime.bridge = { slidesEl, sync: vi.fn() }
  return slidesEl
}

beforeEach(() => {
  vi.clearAllMocks()
  editor.dirty = false
  api.deleteAsset.mockResolvedValue({ ok: true })
  save.saveDeck.mockImplementation(async () => { editor.dirty = false })
})

describe('optimizeDeckMedia', () => {
  it('rewrites the slides, saves once, and deletes the superseded original', async () => {
    const slidesEl = setSlides('<section><img src="assets/a.png"><img data-src="assets/a.png"></section>')
    api.optimizeAsset.mockResolvedValue({ path: 'assets/a-1234abcd.png', before: 1000, after: 400 })
    api.fetchDeck.mockResolvedValue({ html: '<html><body><img src="assets/a-1234abcd.png"></body></html>' })

    const { results, saved } = await optimizeDeckMedia({ paths: ['assets/a.png'] })

    expect(results).toEqual([{ source: 'assets/a.png', path: 'assets/a-1234abcd.png', before: 1000, after: 400, references: 2, deleted: true }])
    expect(saved).toBe(true)
    expect(slidesEl.querySelectorAll('[src="assets/a-1234abcd.png"], [data-src="assets/a-1234abcd.png"]')).toHaveLength(2)
    expect(actions.snapshotDeck).toHaveBeenCalledTimes(1)
    expect(save.saveDeck).toHaveBeenCalledTimes(1)
    expect(api.deleteAsset).toHaveBeenCalledWith('a.png')
  })

  it('keeps an original the saved deck still refers to', async () => {
    setSlides('<section><img src="assets/a.png"></section>')
    api.optimizeAsset.mockResolvedValue({ path: 'assets/a-1234abcd.png', before: 1000, after: 400 })
    // e.g. a background in the deck head that the slides do not carry
    api.fetchDeck.mockResolvedValue({ html: '<html><body style="background: url(assets/a.png)"></body></html>' })

    const { results } = await optimizeDeckMedia({ paths: ['assets/a.png'] })
    expect(results[0].deleted).toBeUndefined()
    expect(api.deleteAsset).not.toHaveBeenCalled()
  })

  it('takes one snapshot for the whole run and never one for a kept or skipped asset', async () => {
    setSlides('<section><img src="assets/a.png"><img src="assets/b.jpg"></section>')
    api.optimizeAsset
      .mockResolvedValueOnce({ kept: true, before: 100, after: 99 })
      .mockResolvedValueOnce({ skipped: true, reason: 'vector image' })
    const { results, saved } = await optimizeDeckMedia({ paths: ['assets/a.png', 'assets/b.jpg'] })
    expect(results.map((r) => r.source)).toEqual(['assets/a.png', 'assets/b.jpg'])
    expect(actions.snapshotDeck).not.toHaveBeenCalled()
    expect(save.saveDeck).not.toHaveBeenCalled()
    expect(saved).toBe(false)
  })

  it('records a failing asset and carries on with the next one', async () => {
    const slidesEl = setSlides('<section><img src="assets/a.png"><img src="assets/b.png"></section>')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.optimizeAsset
      .mockRejectedValueOnce(new Error('convert exited with code 1'))
      .mockResolvedValueOnce({ path: 'assets/b-5678ef90.png', before: 10, after: 4 })
    api.fetchDeck.mockResolvedValue({ html: '<html><body></body></html>' })

    const { results } = await optimizeDeckMedia({ paths: ['assets/a.png', 'assets/b.png'] })
    expect(results[0].error).toMatch(/convert exited/)
    expect(results[1].path).toBe('assets/b-5678ef90.png')
    expect(slidesEl.querySelector('[src="assets/a.png"]')).not.toBe(null)
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })

  it('leaves the originals alone when the save did not go through', async () => {
    setSlides('<section><img src="assets/a.png"></section>')
    api.optimizeAsset.mockResolvedValue({ path: 'assets/a-1234abcd.png', before: 1000, after: 400 })
    save.saveDeck.mockImplementation(async () => { editor.dirty = true })

    const { saved } = await optimizeDeckMedia({ paths: ['assets/a.png'] })
    expect(saved).toBe(false)
    expect(api.deleteAsset).not.toHaveBeenCalled()
  })

  it('stops at the next asset once the run is aborted', async () => {
    setSlides('<section><img src="assets/a.png"></section>')
    const controller = new AbortController()
    api.optimizeAsset.mockImplementation(async () => {
      controller.abort()
      return { kept: true, before: 1, after: 1 }
    })
    const { results } = await optimizeDeckMedia({ paths: ['assets/a.png', 'assets/b.png'], signal: controller.signal })
    expect(results).toHaveLength(1)
    expect(api.optimizeAsset).toHaveBeenCalledTimes(1)
  })

  it('refuses to run before the deck is ready', async () => {
    runtime.bridge = null
    await expect(optimizeDeckMedia({ paths: ['assets/a.png'] })).rejects.toThrow('not ready')
  })
})
