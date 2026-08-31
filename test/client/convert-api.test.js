// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { convertAsset } from '../../src/client/lib/api.js'

// a Response whose body arrives in the given chunks (lines may split across them)
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

describe('convertAsset', () => {
  it('reports progress and resolves to the final path', async () => {
    const seen = []
    const fetchImpl = async (url, init) => {
      expect(url).toBe('/api/assets/convert')
      expect(JSON.parse(init.body)).toEqual({ path: 'assets/clip.mov' })
      return streamed(['{"progress":0.25}\n{"prog', 'ress":0.5}\n', '{"path":"assets/clip.webm"}\n'])
    }
    const path = await convertAsset('assets/clip.mov', { fetchImpl, onProgress: (p) => seen.push(p) })
    expect(path).toBe('assets/clip.webm')
    expect(seen).toEqual([0.25, 0.5])
  })

  it('rejects with the server error from the stream', async () => {
    const fetchImpl = async () => streamed(['{"progress":0.1}\n{"error":"ffmpeg exited with code 1"}\n'])
    await expect(convertAsset('assets/clip.mov', { fetchImpl })).rejects.toThrow('ffmpeg exited with code 1')
  })

  it('rejects on a non-2xx response', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: 'ffmpeg is not installed on this machine' }), { status: 501 })
    await expect(convertAsset('assets/clip.mov', { fetchImpl })).rejects.toThrow('ffmpeg is not installed')
  })

  it('rejects when the stream ends without a result', async () => {
    const fetchImpl = async () => streamed(['{"progress":0.1}\n'])
    await expect(convertAsset('assets/clip.mov', { fetchImpl })).rejects.toThrow('without a result')
  })
})
