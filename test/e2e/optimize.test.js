// @vitest-environment node
// Media optimization: option handling and encoder arguments (pure), and the
// /api/assets/optimize route against a real ffmpeg and ImageMagick when the
// machine has them.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../../src/server/index.js'
import { scaffoldDeck } from '../../src/server/scaffold.js'
import { ffmpegVersion, imageMagickVersion } from '../../src/server/convert.js'
import { contentAddressedName, stripHashSuffix } from '../../src/server/asset-names.js'
import {
  imageOptimizeArgs, normalizeOptimizeOptions, optimizeKind, optimizeOutputExtension,
  skipReason, videoOptimizeArgs, videoScaleFilter
} from '../../src/server/optimize.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const run = promisify(execFile)

describe('optimize options', () => {
  it('fills in the defaults', () => {
    expect(normalizeOptimizeOptions()).toEqual({
      maxDimension: 2560, imageQuality: 85, imageFormat: 'keep', videoCrf: 32, minSaving: 0.1
    })
    expect(normalizeOptimizeOptions({ videoCrf: 40 }).videoCrf).toBe(40)
  })

  it('rejects values no encoder can act on', () => {
    expect(() => normalizeOptimizeOptions({ videoCrf: 99 })).toThrow('videoCrf must be between 0 and 63')
    expect(() => normalizeOptimizeOptions({ imageQuality: 0 })).toThrow('imageQuality must be between 1 and 100')
    expect(() => normalizeOptimizeOptions({ maxDimension: 100.5 })).toThrow('whole number')
    expect(() => normalizeOptimizeOptions({ maxDimension: '2560' })).toThrow('must be a number')
    expect(() => normalizeOptimizeOptions({ minSaving: 1 })).toThrow('minSaving must be between 0 and 0.95')
    expect(() => normalizeOptimizeOptions({ imageFormat: 'avif' })).toThrow("imageFormat must be 'keep' or 'webp'")
  })

  it('rejects an unknown option rather than ignoring it', () => {
    expect(() => normalizeOptimizeOptions({ imagequality: 70 })).toThrow('unknown option: imagequality')
    expect(() => normalizeOptimizeOptions('fast')).toThrow('options must be an object')
  })
})

describe('encoder arguments', () => {
  it('caps the longer side without upscaling, at an even size', () => {
    expect(videoScaleFilter(1920)).toBe(
      "scale=w='if(gte(iw,ih),2*floor((min(1920,iw))/2),-2)':h='if(gte(iw,ih),-2,2*floor((min(1920,ih))/2))'")
    expect(imageOptimizeArgs({ input: 'a.jpg', output: 'b.jpg', quality: 85, maxDimension: 2560 }))
      .toEqual(['a.jpg[0]', '-auto-orient', '-resize', '2560x2560>', '-strip', '-quality', '85', 'b.jpg'])
  })

  it('re-encodes video with the shared WebM settings at the chosen crf, without metadata', () => {
    const args = videoOptimizeArgs({ input: 'a.mov', output: 'b.webm', crf: 36, maxDimension: 1280 })
    expect(args.join(' ')).toContain('-c:v libvpx-vp9 -crf 36 -b:v 0 -c:a libopus')
    expect(args).toContain('-map_metadata')
    expect(args[args.indexOf('-map_metadata') + 1]).toBe('-1')
    expect(args[args.length - 1]).toBe('b.webm')
  })

  it('keeps the image format unless WebP is asked for, and targets WebM for video', () => {
    expect(optimizeOutputExtension('a.png', { imageFormat: 'keep' })).toBe('.png')
    expect(optimizeOutputExtension('a.jpeg', { imageFormat: 'keep' })).toBe('.jpg')
    expect(optimizeOutputExtension('a.png', { imageFormat: 'webp' })).toBe('.webp')
    expect(optimizeOutputExtension('a.mov', { imageFormat: 'webp' })).toBe('.webm')
    expect(imageOptimizeArgs({ input: 'a.png', output: 'b.png', quality: 85, maxDimension: 800 }))
      .not.toContain('-quality')
  })

  it('classifies what it can optimize and says why it skips the rest', () => {
    expect(optimizeKind('a.mov')).toBe('video')
    expect(optimizeKind('a.JPEG')).toBe('image')
    expect(optimizeKind('a.svg')).toBe(null)
    expect(skipReason('a.png')).toBe(null)
    expect(skipReason('a.svg')).toBe('vector image')
    expect(skipReason('a.gif')).toMatch(/animation/)
    expect(skipReason('a.txt')).toBe('unsupported format: .txt')
  })

  it('names the result after its content, without chaining hashes', () => {
    const bytes = Buffer.from('some bytes')
    const name = contentAddressedName('photo.webp', bytes, { ext: '.webp' })
    expect(name).toMatch(/^photo-[0-9a-f]{8}\.webp$/)
    expect(stripHashSuffix('photo-1a2b3c4d')).toBe('photo')
    expect(stripHashSuffix('photo')).toBe('photo')
  })
})

const haveFfmpeg = (await ffmpegVersion()) !== null
const magick = await imageMagickVersion()

async function postOptimize(base, body) {
  return fetch(`${base}api/assets/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function readStream(res) {
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
  return { progress: lines.filter((l) => 'progress' in l), last: lines[lines.length - 1] }
}

describe.skipIf(!haveFfmpeg || !magick)('POST /api/assets/optimize', () => {
  let dir, deckDir, server, base

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reveal-editor-optimize-'))
    const deckPath = await scaffoldDeck(join(dir, 'deck'))
    deckDir = join(dir, 'deck')
    const assets = join(deckDir, 'assets')
    await mkdir(assets, { recursive: true })
    await run('ffmpeg', [
      '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=640x360:rate=10',
      '-c:v', 'mpeg4', join(assets, 'clip.mp4')
    ])
    // noise, so the encoders have something real to work on
    await run(magick.bin, ['-size', '1200x800', 'plasma:fractal', join(assets, 'photo.jpg')])
    await run(magick.bin, ['-size', '1200x800', 'plasma:fractal', join(assets, 'sheet.png')])
    await run(magick.bin, ['-size', '40x30', 'plasma:fractal', join(assets, 'tiny.jpg')])
    await run('sh', ['-c', `printf '<svg xmlns="http://www.w3.org/2000/svg"/>' > "${join(assets, 'logo.svg')}"`])
    const started = await createServer({ deckPath, port: 0, dev: false, repoRoot })
    server = started.server
    base = started.url
  }, 60_000)

  afterAll(async () => {
    server?.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('lists the deck assets with their sizes', async () => {
    const { assets } = await (await fetch(`${base}api/assets`)).json()
    const photo = assets.find((a) => a.path === 'assets/photo.jpg')
    expect(photo.size).toBe((await stat(join(deckDir, 'assets', 'photo.jpg'))).size)
  })

  it('re-encodes a video smaller, streaming progress', async () => {
    const res = await postOptimize(base, { path: 'assets/clip.mp4', options: { maxDimension: 320 } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    const { progress, last } = await readStream(res)
    expect(progress.length).toBeGreaterThan(0)
    expect(last.path).toMatch(/^assets\/clip-[0-9a-f]{8}\.webm$/)
    expect(last.after).toBeLessThan(last.before)
    expect((await stat(join(deckDir, 'assets', last.path.split('/').pop()))).size).toBe(last.after)
    // the original is the client's to remove, not the server's
    expect(existsSync(join(deckDir, 'assets', 'clip.mp4'))).toBe(true)
    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(deckDir, 'assets', last.path.split('/').pop())])
    expect(probe.stdout.trim()).toBe('320,180')
  }, 120_000)

  it('shrinks a JPEG and keeps its format', async () => {
    const before = (await stat(join(deckDir, 'assets', 'photo.jpg'))).size
    const { last } = await readStream(await postOptimize(base, { path: 'assets/photo.jpg', options: { maxDimension: 600 } }))
    expect(last.path).toMatch(/^assets\/photo-[0-9a-f]{8}\.jpg$/)
    expect(last.before).toBe(before)
    expect(last.after).toBeLessThan(before)
  }, 60_000)

  it('writes WebP when asked to, and never converts a PNG to JPEG', async () => {
    const { last: webp } = await readStream(await postOptimize(base, {
      path: 'assets/sheet.png', options: { imageFormat: 'webp', maxDimension: 600 }
    }))
    expect(webp.path).toMatch(/\.webp$/)
    const { last: png } = await readStream(await postOptimize(base, {
      path: 'assets/sheet.png', options: { maxDimension: 600 }
    }))
    expect(png.path).toMatch(/\.png$/)
  }, 60_000)

  it('keeps the original when the saving is too small to be worth it', async () => {
    const { last } = await readStream(await postOptimize(base, {
      path: 'assets/tiny.jpg', options: { minSaving: 0.95, maxDimension: 2560 }
    }))
    expect(last).toMatchObject({ kept: true })
    expect(last.after).toBeGreaterThan(0)
    const names = await readdir(join(deckDir, 'assets'))
    expect(names.filter((n) => n.startsWith('tiny-'))).toEqual([])
    expect(names.filter((n) => n.startsWith('.re-convert-'))).toEqual([])
  }, 60_000)

  it('skips formats it would damage', async () => {
    const { last } = await readStream(await postOptimize(base, { path: 'assets/logo.svg' }))
    expect(last).toEqual({ skipped: true, reason: 'vector image' })
  })

  it('reports a failing encoder rather than a silent skip', async () => {
    await run('sh', ['-c', `printf 'not a video' > "${join(deckDir, 'assets', 'bogus.mov')}"`])
    const { last } = await readStream(await postOptimize(base, { path: 'assets/bogus.mov' }))
    expect(last.error).toMatch(/exited with code/)
    expect((await readdir(join(deckDir, 'assets'))).filter((n) => n.startsWith('.re-convert-'))).toEqual([])
  }, 60_000)

  it('refuses paths outside the deck folder, missing files and bad options', async () => {
    expect((await postOptimize(base, { path: '../outside.jpg' })).status).toBe(400)
    expect((await postOptimize(base, { path: '/etc/passwd' })).status).toBe(400)
    expect((await postOptimize(base, { path: 'https://example.com/a.jpg' })).status).toBe(400)
    expect((await postOptimize(base, { path: 'assets/nope.jpg' })).status).toBe(404)
    const bad = await postOptimize(base, { path: 'assets/photo.jpg', options: { videoCrf: 99 } })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/videoCrf/)
  })
})

describe.skipIf(!magick)('DELETE /api/assets/:name', () => {
  let dir, deckDir, server, base

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reveal-editor-delete-'))
    const deckPath = await scaffoldDeck(join(dir, 'deck'))
    deckDir = join(dir, 'deck')
    await mkdir(join(deckDir, 'assets'), { recursive: true })
    await run(magick.bin, ['-size', '8x8', 'xc:red', join(deckDir, 'assets', 'old.png')])
    const started = await createServer({ deckPath, port: 0, dev: false, repoRoot })
    server = started.server
    base = started.url
  }, 30_000)

  afterAll(async () => {
    server?.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('removes one asset', async () => {
    const res = await fetch(`${base}api/assets/old.png`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(existsSync(join(deckDir, 'assets', 'old.png'))).toBe(false)
    expect((await fetch(`${base}api/assets/old.png`, { method: 'DELETE' })).status).toBe(404)
  })

  it('refuses names that reach outside the assets folder', async () => {
    for (const name of ['..%2Fdeck.html', '%2Fetc%2Fpasswd', '..', '.hidden']) {
      const res = await fetch(`${base}api/assets/${name}`, { method: 'DELETE' })
      expect([400, 404, 405]).toContain(res.status)
    }
    expect(existsSync(join(deckDir, 'deck.html')) || existsSync(join(deckDir, 'presentation.html'))).toBe(true)
  })
})
