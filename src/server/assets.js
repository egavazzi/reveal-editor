import express from 'express'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { convertImage, convertToWebm, ffmpegVersion, imageMagickVersion, imageOutputName, isVideoFile } from './convert.js'
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

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 80)
}

export function assetsRouter(deckDir) {
  const router = express.Router()
  const assetsDir = resolve(deckDir, 'assets')

  router.get('/', async (req, res) => {
    try {
      const files = existsSync(assetsDir) ? await readdir(assetsDir) : []
      res.json({ assets: files.filter((f) => !f.startsWith('.')).sort().map((f) => `assets/${f}`) })
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
      const mimeExt = EXT_BY_MIME[req.headers['content-type']] ?? ''
      const ext = extname(requested) || mimeExt || '.bin'
      const stem = requested.replace(/\.[^.]*$/, '') || 'asset'
      const hash = createHash('sha1').update(req.body).digest('hex').slice(0, 8)
      const filename = `${stem}-${hash}${ext}`
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

  // Resolve a deck-relative media path (as written in a <video src>) to a
  // file inside the deck directory; null for anything outside it or remote.
  const deckFile = (relPath) => {
    if (typeof relPath !== 'string' || relPath === '' || /^[a-z][a-z0-9+.-]*:/i.test(relPath)) return null
    let decoded
    try {
      decoded = decodeURIComponent(relPath.split(/[?#]/)[0])
    } catch {
      return null
    }
    const abs = resolve(deckDir, decoded)
    return abs.startsWith(deckDir + sep) ? abs : null
  }

  // Which converters this machine has: ffmpeg for video, ImageMagick for
  // images. Each field is a version string, or null when the tool is absent.
  router.get('/convert', async (req, res) => {
    const [ffmpeg, magick] = await Promise.all([ffmpegVersion(), imageMagickVersion()])
    res.json({ ffmpeg, imagemagick: magick?.version ?? null })
  })

  // Stream a conversion job as newline-delimited JSON: `{"progress": f}`
  // lines while it runs, then `{"path": "…"}` or `{"error": "…"}`. Closing
  // the request kills the converter and removes the partial output.
  const streamJob = async (res, makeJob, outputRel, label) => {
    res.set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' })
    res.flushHeaders()
    const send = (obj) => res.write(`${JSON.stringify(obj)}\n`)
    const job = makeJob(send)
    let finished = false
    // the socket closing before the response completes is a client abort
    res.on('close', () => {
      if (!finished && !res.writableFinished) job.abort()
    })
    try {
      await job
      finished = true
      send({ path: outputRel })
    } catch (err) {
      finished = true
      console.error(`conversion of ${label} failed:`, err.message)
      send({ error: String(err.message ?? err) })
    }
    res.end()
  }

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
      return streamJob(res, (send) => {
        let lastSent = -1
        return convertToWebm({
          input,
          output,
          onProgress: (fraction) => {
            // throttle to whole percents: ffmpeg reports several times a second
            const pct = Math.floor(fraction * 100)
            if (pct !== lastSent) {
              lastSent = pct
              send({ progress: pct / 100 })
            }
          }
        })
      }, webmOutputName(relPath), req.body.path)
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
    }, imageOutputName(relPath), req.body.path)
  })

  return router
}
