// @vitest-environment node
// Server-side video conversion: ffmpeg progress parsing (pure), and the
// /api/assets/convert route against a real ffmpeg when one is installed.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../../src/server/index.js'
import { scaffoldDeck } from '../../src/server/scaffold.js'
import {
  convertToWebm, ffmpegVersion, imageMagickVersion, imageOutputName, isVideoFile, parseDuration, parseOutTime
} from '../../src/server/convert.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const run = promisify(execFile)

describe('ffmpeg output parsing', () => {
  it('reads the duration from the input banner', () => {
    const banner = "Input #0, mov,mp4\n  Duration: 00:01:02.50, start: 0.000000, bitrate: 1 kb/s\n"
    expect(parseDuration(banner)).toBe(62.5)
    expect(parseDuration('no banner yet')).toBe(null)
  })

  it('reads the latest out_time_us from a -progress chunk', () => {
    const chunk = 'frame=1\nout_time_us=500000\nout_time_ms=500000\nprogress=continue\nout_time_us=1250000\nprogress=continue\n'
    expect(parseOutTime(chunk)).toBe(1.25)
    expect(parseOutTime('speed=1x\n')).toBe(null)
  })
})

describe('media classification', () => {
  it('routes paths to the video or image converter by extension', () => {
    expect(isVideoFile('/deck/assets/clip.MOV')).toBe(true)
    expect(isVideoFile('/deck/assets/clip.webm')).toBe(true)
    expect(isVideoFile('/deck/assets/photo.heic')).toBe(false)
  })

  it('targets JPEG for photo formats and PNG for the rest', () => {
    expect(imageOutputName('/deck/assets/IMG_1.heic')).toBe('/deck/assets/IMG_1.jpg')
    expect(imageOutputName('/deck/assets/scan.tiff')).toBe('/deck/assets/scan.png')
    expect(imageOutputName('/deck/assets/a.png')).toBe('/deck/assets/a.png')
  })
})

const haveFfmpeg = (await ffmpegVersion()) !== null
const magick = await imageMagickVersion()

describe.skipIf(!haveFfmpeg)('POST /api/assets/convert', () => {
  let dir, deckPath, deckDir, server, base

  async function readStream(res) {
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    return { progress: lines.filter((l) => 'progress' in l), last: lines[lines.length - 1] }
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reveal-editor-convert-'))
    deckPath = await scaffoldDeck(join(dir, 'deck'))
    deckDir = join(dir, 'deck')
    await mkdir(join(deckDir, 'assets'), { recursive: true })
    // MPEG-4 Part 2 in an MP4: a codec no current browser decodes
    await run('ffmpeg', [
      '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=10',
      '-c:v', 'mpeg4', join(deckDir, 'assets', 'clip.mp4')
    ])
    const started = await createServer({ deckPath, port: 0, dev: false, repoRoot })
    server = started.server
    base = started.url
  }, 60_000)

  afterAll(async () => {
    server?.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('reports the converters this machine has', async () => {
    const body = await (await fetch(`${base}api/assets/convert`)).json()
    expect(body.ffmpeg).toBeTypeOf('string')
    expect(body.imagemagick).toBe(magick?.version ?? null)
  })

  it('re-encodes a deck video as WebM, streaming progress', async () => {
    const res = await fetch(`${base}api/assets/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets/clip.mp4' })
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    const { progress, last } = await readStream(res)
    expect(last).toEqual({ path: 'assets/clip.webm' })
    expect(progress.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1].progress).toBe(1)
    const out = await readFile(join(deckDir, 'assets', 'clip.webm'))
    // EBML header: WebM/Matroska container
    expect([...out.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
    expect(existsSync(join(deckDir, 'assets', '.re-convert-clip.webm'))).toBe(false)
    // the original stays
    expect(existsSync(join(deckDir, 'assets', 'clip.mp4'))).toBe(true)
  }, 60_000)

  it('refuses paths outside the deck folder and missing files', async () => {
    const post = (path) => fetch(`${base}api/assets/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    })
    expect((await post('../outside.mp4')).status).toBe(400)
    expect((await post('/etc/passwd')).status).toBe(400)
    expect((await post('https://example.com/a.mp4')).status).toBe(400)
    expect((await post('assets/nope.mp4')).status).toBe(404)
    expect((await post('assets/clip.webm')).status).toBe(400)
  })

  it('reports ffmpeg failures in the stream and leaves no partial file', async () => {
    // not a video at all
    await run('sh', ['-c', `printf 'not a video' > "${join(deckDir, 'assets', 'bogus.mov')}"`])
    const res = await fetch(`${base}api/assets/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets/bogus.mov' })
    })
    expect(res.status).toBe(200)
    const { last } = await readStream(res)
    expect(last.error).toMatch(/ffmpeg exited with code/)
    expect(existsSync(join(deckDir, 'assets', 'bogus.webm'))).toBe(false)
    expect(existsSync(join(deckDir, 'assets', '.re-convert-bogus.webm'))).toBe(false)
  }, 30_000)

  it('hides the in-progress output from the asset listing', async () => {
    // a fresh output name, so this doesn't race the earlier test's clip.webm
    const input = join(deckDir, 'assets', 'clip.mp4')
    const output = join(deckDir, 'assets', 'clip2.webm')
    const partial = join(deckDir, 'assets', '.re-convert-clip2.webm')
    const job = convertToWebm({ input, output })
    // ffmpeg opens the partial before it starts encoding; the source clip is
    // tiny, so poll tightly rather than sleeping past the whole conversion
    const deadline = Date.now() + 5000
    while (!existsSync(partial) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2))
    }
    try {
      expect(existsSync(partial)).toBe(true)
      const listing = await (await fetch(`${base}api/assets`)).json()
      expect(listing.assets.some((a) => a.includes('re-convert'))).toBe(false)
    } finally {
      job.abort()
      await job.catch(() => {})
    }
    expect(existsSync(partial)).toBe(false)
  }, 30_000)
})

describe.skipIf(!haveFfmpeg)('leftover conversion files on startup', () => {
  let dir, deckPath, deckDir

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reveal-editor-convert-stale-'))
    deckPath = await scaffoldDeck(join(dir, 'deck'))
    deckDir = join(dir, 'deck')
    await mkdir(join(deckDir, 'assets'), { recursive: true })
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('removes a stray partial left by a killed conversion at startup', async () => {
    const stray = join(deckDir, 'assets', '.re-convert-clip.webm')
    await writeFile(stray, 'leftover from a killed ffmpeg')
    const kept = join(deckDir, 'assets', 'clip.mp4')
    await writeFile(kept, 'not touched')

    const started = await createServer({ deckPath, port: 0, dev: false, repoRoot })
    try {
      expect(existsSync(stray)).toBe(false)
      expect(existsSync(kept)).toBe(true)
    } finally {
      started.server.close()
    }
  })
})

describe.skipIf(!magick)('POST /api/assets/convert (images)', () => {
  let dir, deckPath, deckDir, server, base

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reveal-editor-convert-img-'))
    deckPath = await scaffoldDeck(join(dir, 'deck'))
    deckDir = join(dir, 'deck')
    await mkdir(join(deckDir, 'assets'), { recursive: true })
    // a TIFF: readable by ImageMagick, not displayable by browsers
    await run(magick.bin, ['-size', '8x8', 'xc:red', join(deckDir, 'assets', 'pic.tiff')])
    const started = await createServer({ deckPath, port: 0, dev: false, repoRoot })
    server = started.server
    base = started.url
  }, 30_000)

  afterAll(async () => {
    server?.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('converts a deck image to PNG', async () => {
    const res = await fetch(`${base}api/assets/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets/pic.tiff' })
    })
    expect(res.status).toBe(200)
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines[lines.length - 1]).toEqual({ path: 'assets/pic.png' })
    const out = await readFile(join(deckDir, 'assets', 'pic.png'))
    expect([...out.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(existsSync(join(deckDir, 'assets', '.re-convert-pic.png'))).toBe(false)
    expect(existsSync(join(deckDir, 'assets', 'pic.tiff'))).toBe(true)
  }, 30_000)

  it('refuses an image that is already displayable', async () => {
    const res = await fetch(`${base}api/assets/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets/pic.png' })
    })
    expect(res.status).toBe(400)
  })
})
