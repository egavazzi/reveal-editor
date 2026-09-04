import express from 'express'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { cleanupPartials, convertImage, convertToWebm, ffmpegVersion, imageMagickVersion, imageOutputName, isVideoFile } from './convert.js'
import { contentAddressedName, safeName } from './asset-names.js'
import { percentProgress, resolveDeckFile, streamJob } from './http.js'
import { webmOutputName } from '../client/lib/model/codecs.js'

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm'
}

export async function assetsRouter(deckDir) {
  const router = express.Router()
  const assetsDir = resolve(deckDir, 'assets')
  await cleanupPartials(assetsDir)

  // Every file in assets/ as `{ path, size }`, sorted by name. Dot-files
  // are hidden: they are conversion temporaries, not deck assets.
  router.get('/', async (req, res) => {
    try {
      const files = existsSync(assetsDir) ? await readdir(assetsDir) : []
      const assets = []
      for (const name of files.filter((f) => !f.startsWith('.')).sort()) {
        assets.push({ path: `assets/${name}`, size: (await stat(resolve(assetsDir, name))).size })
      }
      res.json({ assets })
    } catch (err) {
      res.status(500).json({ error: String(err.message ?? err) })
    }
  })

  router.post('/', express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'empty body' })
      }
      const requested = safeName(String(req.query.name ?? 'pasted'))
      const ext = extname(requested) || EXT_BY_MIME[req.headers['content-type']] || ''
      const filename = contentAddressedName(requested, req.body, { ext })
      const target = resolve(assetsDir, filename)
      if (!target.startsWith(assetsDir)) {
        return res.status(400).json({ error: 'invalid name' })
      }
      await mkdir(assetsDir, { recursive: true })
      if (!existsSync(target)) {
        await writeFile(target, req.body)
      } else {
        // Same name means same content hash; verify to be safe.
        const existing = await readFile(target)
        if (!existing.equals(req.body)) await writeFile(target, req.body)
      }
      res.json({ path: `assets/${filename}` })
    } catch (err) {
      res.status(500).json({ error: String(err.message ?? err) })
    }
  })

  const deckFile = (relPath) => resolveDeckFile(deckDir, relPath)

  // Which converters this machine has: ffmpeg for video, ImageMagick for
  // images. Each field is a version string, or null when the tool is absent.
  router.get('/convert', async (req, res) => {
    const [ffmpeg, magick] = await Promise.all([ffmpegVersion(), imageMagickVersion()])
    res.json({ ffmpeg, imagemagick: magick?.version ?? null })
  })

  // Convert a deck video to WebM, or a deck image to JPEG/PNG, writing the
  // result next to the original (which is kept).
  router.post('/convert', async (req, res) => {
    const input = deckFile(req.body?.path)
    if (!input) return res.status(400).json({ error: 'path must point inside the deck folder' })
    if (!existsSync(input)) return res.status(404).json({ error: `no such file: ${req.body.path}` })
    const relPath = String(req.body.path).split(/[?#]/)[0]

    if (isVideoFile(input)) {
      if ((await ffmpegVersion()) === null) {
        return res.status(501).json({ error: 'ffmpeg is not installed on this machine' })
      }
      const output = webmOutputName(input)
      if (output === input) return res.status(400).json({ error: 'file is already a .webm' })
      return streamJob(res, (send) => convertToWebm({
        input, output, onProgress: percentProgress(send)
      }), () => ({ path: webmOutputName(relPath) }), req.body.path)
    }

    const magick = await imageMagickVersion()
    if (!magick) {
      return res.status(501).json({ error: 'ImageMagick is not installed on this machine' })
    }
    const output = imageOutputName(input)
    if (output === input) return res.status(400).json({ error: 'file is already a .png/.jpg' })
    // ImageMagick reads a trailing [..] in a file name as a frame selector
    if (/[[\]]/.test(input)) {
      return res.status(400).json({ error: 'file names containing [ or ] cannot be converted; rename the file' })
    }
    return streamJob(res, (send) => {
      const job = convertImage({ input, output, bin: magick.bin })
      // ImageMagick reports no progress; one line keeps the envelope uniform
      send({ progress: 1 })
      return job
    }, () => ({ path: imageOutputName(relPath) }), req.body.path)
  })

  return router
}
