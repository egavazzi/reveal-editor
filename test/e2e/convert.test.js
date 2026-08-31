// @vitest-environment node
// Server-side video conversion: ffmpeg progress parsing (pure), and the
// /api/assets/convert route against a real ffmpeg when one is installed.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../../src/server/index.js'
import { scaffoldDeck } from '../../src/server/scaffold.js'
import { ffmpegVersion, parseDuration, parseOutTime } from '../../src/server/convert.js'

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

const haveFfmpeg = (await ffmpegVersion()) !== null

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

  it('reports that ffmpeg is available', async () => {
    const body = await (await fetch(`${base}api/assets/convert`)).json()
    expect(body.available).toBe(true)
    expect(body.version).toBeTypeOf('string')
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
    expect(existsSync(join(deckDir, 'assets', 'clip.webm.part'))).toBe(false)
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
    expect(existsSync(join(deckDir, 'assets', 'bogus.webm.part'))).toBe(false)
  }, 30_000)
})
