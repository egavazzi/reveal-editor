// @vitest-environment node
// Media re-encoding for the self-contained export: preset tables and encoder
// arguments (pure), and the /api/export/media route against a real ffmpeg and
// ImageMagick when the machine has them.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../../src/server/index.js'
import { scaffoldDeck } from '../../src/server/scaffold.js'
import { ffmpegVersion, hasFfmpegEncoder, imageMagickVersion } from '../../src/server/convert.js'
import {
  exportMedia, fitWithin, imageExportArgs, parseMeanSsim, parseMeanVolume, ssimArgs, videoExportArgs
} from '../../src/server/export-media.js'
import {
  DEFAULT_EXPORT_PRESET, EXPORT_PRESETS, exportCodec, exportPreset
} from '../../src/client/lib/model/export-presets.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const run = promisify(execFile)

describe('export presets', () => {
  it('describes every preset the dialog offers', () => {
    expect(Object.keys(EXPORT_PRESETS)).toEqual(['original', 'near-lossless', 'compact'])
    expect(DEFAULT_EXPORT_PRESET).toBe('near-lossless')
    for (const preset of Object.values(EXPORT_PRESETS)) {
      expect(preset.description).toBeTypeOf('string')
      expect(preset.description.length).toBeGreaterThan(0)
    }
    expect(exportPreset('compact').video).toEqual({ vp9Crf: 30, av1Crf: 34 })
    expect(exportPreset('near-lossless').ssimFloor).toBe(0.98)
    expect(exportCodec('av1').description).toMatch(/recent browser/)
  })

  it('rejects a preset or codec it has no settings for', () => {
    expect(() => exportPreset('tiny')).toThrow('unknown export preset: "tiny"')
    expect(() => exportCodec('h264')).toThrow('unknown video codec: "h264"')
  })
})

describe('export sizing', () => {
  it('shrinks to fit the target and never upscales', () => {
    expect(fitWithin({ width: 1200, height: 800 }, { width: 600, height: 600 }))
      .toEqual({ width: 600, height: 400 })
    expect(fitWithin({ width: 300, height: 200 }, { width: 600, height: 600 })).toBe(null)
    expect(fitWithin({ width: 300, height: 200 }, null)).toBe(null)
  })

  it('rounds to an even size, which VP9 and AV1 require', () => {
    // rounded down, so the result never exceeds the target box
    expect(fitWithin({ width: 1001, height: 667 }, { width: 501, height: 501 }))
      .toEqual({ width: 500, height: 332 })
  })
})

describe('encoder arguments', () => {
  it('keeps PNG pixels and re-encodes JPEG at the preset quality', () => {
    expect(imageExportArgs({ input: 'a.png', output: 'b.png', size: { width: 100, height: 50 } }))
      .toEqual(['a.png[0]', '-auto-orient', '-resize', '100x50!', '-strip', '-define', 'png:compression-level=9', 'b.png'])
    expect(imageExportArgs({ input: 'a.jpg', output: 'b.jpg', quality: 93, samplingFactor: '4:4:4' }))
      .toEqual(['a.jpg[0]', '-auto-orient', '-strip', '-quality', '93', '-sampling-factor', '4:4:4', 'b.jpg'])
    expect(imageExportArgs({ input: 'a.png', output: 'b.webp', quality: 90 }))
      .toContain('webp:method=6')
  })

  it('encodes VP9 or AV1 at the preset crf, without metadata', () => {
    const vp9 = videoExportArgs({ input: 'a.mov', output: 'b.webm', crf: 22, size: { width: 640, height: 360 } })
    expect(vp9.join(' ')).toContain('-c:v libvpx-vp9 -crf 22 -b:v 0 -c:a libopus')
    expect(vp9.join(' ')).toContain('-vf scale=640:360:flags=lanczos')
    expect(vp9[vp9.indexOf('-map_metadata') + 1]).toBe('-1')

    const av1 = videoExportArgs({ input: 'a.mov', output: 'b.webm', crf: 27, codec: 'av1', audio: false })
    expect(av1.join(' ')).toContain('-c:v libsvtav1 -crf 27 -preset 6 -an')
    expect(av1.join(' ')).not.toContain('-vf')
  })

  it('compares the encode against the source scaled to the same size', () => {
    const args = ssimArgs({ encoded: 'out.webm', source: 'in.mov', size: { width: 320, height: 180 } })
    expect(args.join(' ')).toContain('[1:v]scale=320:180')
    expect(args.join(' ')).toContain('[enc][ref]ssim')
  })

  it('reads the SSIM and volume ffmpeg reports', () => {
    expect(parseMeanSsim('[Parsed_ssim_2 @ 0x1] SSIM Y:0.99 U:0.99 V:0.99 All:0.991234 (20.6)')).toBe(0.991234)
    expect(parseMeanSsim('no ssim here')).toBe(null)
    expect(parseMeanVolume('[Parsed_volumedetect_0 @ 0x1] mean_volume: -91.0 dB')).toBe(-91)
    expect(parseMeanVolume('n/a')).toBe(null)
  })
})

const haveFfmpeg = (await ffmpegVersion()) !== null
const magick = await imageMagickVersion()
const haveAv1 = haveFfmpeg && (await hasFfmpegEncoder('libsvtav1'))

async function postMedia(base, body) {
  return fetch(`${base}api/export/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function readStream(res) {
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
  return { progress: lines.filter((l) => 'progress' in l), last: lines[lines.length - 1] }
}

async function digestDir(dir) {
  const names = (await readdir(dir)).sort()
  const hashes = []
  for (const name of names) {
    hashes.push(`${name}:${createHash('sha1').update(await readFile(join(dir, name))).digest('hex')}`)
  }
  return hashes
}

describe.skipIf(!haveFfmpeg || !magick)('POST /api/export/media', () => {
  let dir, deckDir, assetsDir, server, base, assetsBefore

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reveal-editor-export-'))
    const deckPath = await scaffoldDeck(join(dir, 'deck'))
    deckDir = join(dir, 'deck')
    assetsDir = join(deckDir, 'assets')
    await mkdir(assetsDir, { recursive: true })
    await run('ffmpeg', [
      '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=640x360:rate=10',
      '-c:v', 'mpeg4', join(assetsDir, 'clip.mp4')
    ])
    // random noise: no encoder keeps it faithful, which is what the SSIM
    // guard exists to catch
    await run('ffmpeg', [
      '-nostdin', '-y', '-f', 'lavfi',
      '-i', 'nullsrc=s=320x240:d=1:r=10,geq=random(1)*255:128:128',
      '-c:v', 'ffv1', join(assetsDir, 'noise.mkv')
    ])
    await run('ffmpeg', [
      '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=8',
      join(assetsDir, 'anim.gif')
    ])
    await run('ffmpeg', [
      '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-shortest',
      '-c:v', 'mpeg4', '-c:a', 'aac', join(assetsDir, 'silent.mp4')
    ])
    await run(magick.bin, ['-size', '1200x800', 'plasma:fractal', join(assetsDir, 'photo.jpg')])
    // stored uncompressed, so a lossless recompression is a real saving
    await run(magick.bin, ['-size', '600x400', 'plasma:fractal',
      '-define', 'png:compression-level=0', join(assetsDir, 'sheet.png')])
    await run('sh', ['-c', `printf '<svg xmlns="http://www.w3.org/2000/svg"/>' > "${join(assetsDir, 'logo.svg')}"`])
    assetsBefore = await digestDir(assetsDir)
    const started = await createServer({ deckPath, port: 0, dev: false, repoRoot })
    server = started.server
    base = started.url
  }, 120_000)

  afterAll(async () => {
    server?.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('resizes a JPEG down to the size it is shown at', async () => {
    const { last } = await readStream(await postMedia(base, {
      path: 'assets/photo.jpg', preset: 'near-lossless', target: { width: 600, height: 600 }
    }))
    expect(last.path).toMatch(/^\/api\/export\/media\/photo-[0-9a-f]{8}\.jpg$/)
    expect(last.after).toBeLessThan(last.before)
    const served = await fetch(`${base}${last.path.slice(1)}`)
    expect(served.status).toBe(200)
    const bytes = Buffer.from(await served.arrayBuffer())
    expect(bytes.length).toBe(last.after)
    const identify = await run(magick.bin === 'magick' ? 'magick' : 'identify',
      [...(magick.bin === 'magick' ? ['identify'] : []), '-format', '%w %h',
        join(deckDir, '.re-export', last.path.split('/').pop())])
    expect(identify.stdout.trim()).toBe('600 400')
  }, 60_000)

  it('leaves a JPEG byte-for-byte when it is not resized', async () => {
    const { last } = await readStream(await postMedia(base, {
      path: 'assets/photo.jpg', preset: 'near-lossless', target: { width: 4000, height: 4000 }
    }))
    expect(last).toEqual({ skipped: true, reason: 'already at the size it is shown at' })
  }, 60_000)

  it('recompresses a PNG without changing a pixel', async () => {
    const { last } = await readStream(await postMedia(base, {
      path: 'assets/sheet.png', preset: 'near-lossless', target: { width: 4000, height: 4000 }
    }))
    expect(last.path).toMatch(/\.png$/)
    expect(last.after).toBeLessThan(last.before)
    const compare = await run(magick.bin === 'magick' ? 'magick' : 'compare', [
      ...(magick.bin === 'magick' ? ['compare'] : []), '-metric', 'AE',
      join(assetsDir, 'sheet.png'), join(deckDir, '.re-export', last.path.split('/').pop()), 'null:'
    ]).catch((err) => err)
    expect(String(compare.stderr).trim()).toBe('0')
  }, 60_000)

  it('turns a photographic PNG into WebP only for the compact preset', async () => {
    const { last } = await readStream(await postMedia(base, {
      path: 'assets/sheet.png', preset: 'compact', target: { width: 4000, height: 4000 }
    }))
    expect(last.path).toMatch(/\.webp$/)
  }, 60_000)

  it('leaves an SVG alone', async () => {
    const { last } = await readStream(await postMedia(base, { path: 'assets/logo.svg', preset: 'compact' }))
    expect(last).toEqual({ skipped: true, reason: 'vector image' })
  })

  it('re-encodes a video to the target size, streaming progress', async () => {
    const res = await postMedia(base, {
      path: 'assets/clip.mp4', preset: 'near-lossless', target: { width: 320, height: 320 }
    })
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    const { progress, last } = await readStream(res)
    expect(progress.length).toBeGreaterThan(0)
    expect(last.path).toMatch(/^\/api\/export\/media\/clip-[0-9a-f]{8}\.webm$/)
    expect(last.ssim).toBeGreaterThanOrEqual(0.98)
    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
      join(deckDir, '.re-export', last.path.split('/').pop())])
    expect(probe.stdout.trim()).toBe('320,180')
  }, 180_000)

  it('keeps the original when the encode falls below the SSIM floor', async () => {
    // a floor no encode of noise can reach, so the guard is what decides
    const preset = { ...exportPreset('compact'), ssimFloor: 0.9999 }
    const result = await exportMedia({
      input: join(assetsDir, 'noise.mkv'), outDir: join(deckDir, '.re-export'), preset
    })
    expect(result).toMatchObject({ kept: true, reason: 'ssim below threshold' })
    expect(result.ssim).toBeLessThan(0.9999)
    expect((await readdir(join(deckDir, '.re-export'))).some((n) => n.startsWith('noise-'))).toBe(false)
  }, 180_000)

  it('embeds a re-encoded video when it clears the floor', async () => {
    const { last } = await readStream(await postMedia(base, {
      path: 'assets/noise.mkv', preset: 'compact'
    }))
    expect(last.error).toBeUndefined()
    expect(last.ssim).toBeGreaterThanOrEqual(0.95)
  }, 180_000)

  it('drops an audio track that carries only silence', async () => {
    const { last } = await readStream(await postMedia(base, {
      path: 'assets/silent.mp4', preset: 'compact', target: { width: 160, height: 160 }
    }))
    expect(last.path).toMatch(/\.webm$/)
    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'a',
      '-show_entries', 'stream=index', '-of', 'csv=p=0',
      join(deckDir, '.re-export', last.path.split('/').pop())])
    expect(probe.stdout.trim()).toBe('')
  }, 180_000)

  it('converts an animated GIF to video', async () => {
    const { last } = await readStream(await postMedia(base, {
      path: 'assets/anim.gif', preset: 'compact', target: { width: 160, height: 120 }
    }))
    expect(last).toMatchObject({ video: true })
    expect(last.path).toMatch(/\.webm$/)
  }, 180_000)

  it.skipIf(!haveAv1)('encodes AV1 when it is asked for', async () => {
    const { last } = await readStream(await postMedia(base, {
      path: 'assets/clip.mp4', preset: 'compact', codec: 'av1', target: { width: 320, height: 320 }
    }))
    expect(last.path).toMatch(/\.webm$/)
    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v',
      '-show_entries', 'stream=codec_name', '-of', 'csv=p=0',
      join(deckDir, '.re-export', last.path.split('/').pop())])
    expect(probe.stdout.trim()).toBe('av1')
  }, 180_000)

  it('does nothing for the original preset', async () => {
    const res = await postMedia(base, { path: 'assets/photo.jpg', preset: 'original' })
    expect(await res.json()).toEqual({ skipped: true, reason: 'the original was asked for' })
  })

  it('refuses paths outside the deck, missing files and settings it has no numbers for', async () => {
    expect((await postMedia(base, { path: '../outside.jpg', preset: 'compact' })).status).toBe(400)
    expect((await postMedia(base, { path: '/etc/passwd', preset: 'compact' })).status).toBe(400)
    expect((await postMedia(base, { path: 'assets/nope.jpg', preset: 'compact' })).status).toBe(404)
    const preset = await postMedia(base, { path: 'assets/photo.jpg', preset: 'tiny' })
    expect(preset.status).toBe(400)
    expect((await preset.json()).error).toMatch(/unknown export preset/)
    const target = await postMedia(base, { path: 'assets/photo.jpg', preset: 'compact', target: { width: 0, height: 10 } })
    expect(target.status).toBe(400)
    expect((await target.json()).error).toMatch(/target.width/)
    const codec = await postMedia(base, { path: 'assets/clip.mp4', preset: 'compact', codec: 'h264' })
    expect(codec.status).toBe(400)
  })

  it('serves only the files it produced', async () => {
    expect((await fetch(`${base}api/export/media/..%2F..%2Fdeck.html`)).status).toBe(400)
    expect((await fetch(`${base}api/export/media/.hidden`)).status).toBe(400)
    expect((await fetch(`${base}api/export/media/absent-12345678.webm`)).status).toBe(404)
  })

  it('never writes into the deck assets folder', async () => {
    expect(await digestDir(assetsDir)).toEqual(assetsBefore)
    const { assets } = await (await fetch(`${base}api/assets`)).json()
    expect(assets.some((a) => a.path.includes('re-export'))).toBe(false)
  })

  it('drops the scratch folder when the export is done', async () => {
    expect(existsSync(join(deckDir, '.re-export'))).toBe(true)
    const res = await fetch(`${base}api/export/media`, { method: 'DELETE' })
    expect(await res.json()).toEqual({ ok: true })
    expect(existsSync(join(deckDir, '.re-export'))).toBe(false)
    expect(await digestDir(assetsDir)).toEqual(assetsBefore)
  })
})

describe.skipIf(!magick)('leftover export files on startup', () => {
  it('removes a scratch folder a killed export left behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reveal-editor-export-stale-'))
    try {
      const deckPath = await scaffoldDeck(join(dir, 'deck'))
      const stale = join(dir, 'deck', '.re-export')
      await mkdir(stale, { recursive: true })
      await run('sh', ['-c', `printf 'leftover' > "${join(stale, 'photo-12345678.jpg')}"`])
      const started = await createServer({ deckPath, port: 0, dev: false, repoRoot })
      try {
        expect(existsSync(stale)).toBe(false)
        expect(existsSync(deckPath)).toBe(true)
      } finally {
        started.server.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
