// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { deleteAsset, optimizeAsset } from '../../src/client/lib/api.js'
import { deckMediaAssets } from '../../src/client/lib/optimize-media.js'

function streamed(chunks, { status = 200 } = {}) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(encoder.encode(c)))
      controller.close()
    }
  })
  return new Response(body, { status, headers: { 'Content-Type': 'application/x-ndjson' } })
}

describe('optimizeAsset', () => {
  it('sends the options and resolves to the replacement', async () => {
    const seen = []
    const fetchImpl = async (url, init) => {
      expect(url).toBe('/api/assets/optimize')
      expect(JSON.parse(init.body)).toEqual({ path: 'assets/clip.mp4', options: { videoCrf: 34 } })
      return streamed(['{"progress":0.5}\n{"path":"assets/clip-1234abcd.webm","bef', 'ore":100,"after":40}\n'])
    }
    const result = await optimizeAsset('assets/clip.mp4', { videoCrf: 34 }, { fetchImpl, onProgress: (p) => seen.push(p) })
    expect(result).toEqual({ path: 'assets/clip-1234abcd.webm', before: 100, after: 40 })
    expect(seen).toEqual([0.5])
  })

  it('passes the kept and skipped outcomes through', async () => {
    const kept = await optimizeAsset('assets/a.png', {}, { fetchImpl: async () => streamed(['{"kept":true,"before":10,"after":9}\n']) })
    expect(kept).toEqual({ kept: true, before: 10, after: 9 })
    const skipped = await optimizeAsset('assets/a.svg', {}, { fetchImpl: async () => streamed(['{"skipped":true,"reason":"vector image"}\n']) })
    expect(skipped).toEqual({ skipped: true, reason: 'vector image' })
  })

  it('rejects with the error from the stream and from a non-2xx response', async () => {
    await expect(optimizeAsset('assets/a.png', {}, {
      fetchImpl: async () => streamed(['{"error":"convert exited with code 1"}\n'])
    })).rejects.toThrow('convert exited with code 1')
    await expect(optimizeAsset('assets/a.png', { videoCrf: 99 }, {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'videoCrf must be between 0 and 63, got 99' }), { status: 400 })
    })).rejects.toThrow('videoCrf must be between 0 and 63')
  })
})

describe('deleteAsset', () => {
  it('deletes by name and reports a failure', async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toBe('/api/assets/clip-1234abcd.webm')
      expect(init.method).toBe('DELETE')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    expect(await deleteAsset('clip-1234abcd.webm', { fetchImpl })).toEqual({ ok: true })
    await expect(deleteAsset('gone.png', {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'no such asset: gone.png' }), { status: 404 })
    })).rejects.toThrow('no such asset')
  })
})

describe('deckMediaAssets', () => {
  it('keeps images and videos, and marks the ones the slides use', () => {
    const slides = document.createElement('div')
    slides.innerHTML = '<img src="assets/a.png"><section data-background-video="assets/clip.mp4"></section>'
    const listed = [
      { path: 'assets/a.png', size: 2048 },
      { path: 'assets/clip.mp4', size: 5_000_000 },
      { path: 'assets/spare.jpg', size: 100 },
      { path: 'assets/style.css', size: 10 }
    ]
    expect(deckMediaAssets(listed, slides)).toEqual([
      { path: 'assets/a.png', name: 'a.png', kind: 'image', extension: 'png', size: 2048, used: true },
      { path: 'assets/clip.mp4', name: 'clip.mp4', kind: 'video', extension: 'mp4', size: 5_000_000, used: true },
      { path: 'assets/spare.jpg', name: 'spare.jpg', kind: 'image', extension: 'jpg', size: 100, used: false }
    ])
  })
})
