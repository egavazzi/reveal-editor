import express from 'express'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { cleanupPartials, convertImage, convertToWebm, ffmpegVersion, imageMagickVersion, imageOutputName, isVideoFile } from './convert.js'
import { contentAddressedName, safeName } from './asset-names.js'
import { normalizeOptimizeOptions, optimizeAsset, optimizeKind } from './optimize.js'
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

  // Stream a conversion or optimization job as newline-delimited JSON:
  // `{"progress": f}` lines while it runs, then one result line built by
  // `finish` from the job's value, or `{"error": "…"}`. Closing the request
  // kills the tool and removes the partial output.
  const streamJob = async (res, makeJob, finish, label) => {
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
      const value = await job
      finished = true
      send(finish(value))
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
      }, () => ({ path: webmOutputName(relPath) }), req.body.path)
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

  // Re-encode one deck asset smaller and store the result under its
  // content-addressed name in assets/. Streams like /convert, ending in
  // `{path, before, after}`, `{kept, before, after}` when the saving was too
  // small to be worth the quality, or `{skipped, reason}`. The input file is
  // never removed here: only the client knows whether the deck still refers
  // to it.
  router.post('/optimize', async (req, res) => {
    const input = deckFile(req.body?.path)
    if (!input) return res.status(400).json({ error: 'path must point inside the deck folder' })
    if (!existsSync(input)) return res.status(404).json({ error: `no such file: ${req.body.path}` })
    let options
    try {
      options = normalizeOptimizeOptions(req.body?.options ?? {})
    } catch (err) {
      return res.status(400).json({ error: String(err.message ?? err) })
    }
    const kind = optimizeKind(input)
    if (kind === 'video' && (await ffmpegVersion()) === null) {
      return res.status(501).json({ error: 'ffmpeg is not installed on this machine' })
    }
    const magick = kind === 'video' ? null : await imageMagickVersion()
    if (kind !== 'video' && !magick) {
      return res.status(501).json({ error: 'ImageMagick is not installed on this machine' })
    }
    await mkdir(assetsDir, { recursive: true })
    return streamJob(res, (send) => {
      let lastSent = -1
      return optimizeAsset({
        input,
        assetsDir,
        options,
        magickBin: magick?.bin ?? 'convert',
        onProgress: (fraction) => {
          const pct = Math.floor(fraction * 100)
          if (pct !== lastSent) {
            lastSent = pct
            send({ progress: pct / 100 })
          }
        }
      })
    }, (result) => (result.path ? { ...result, path: `assets/${result.path}` } : result), req.body.path)
  })

  // Remove one file from assets/. The client calls this for an original its
  // optimized replacement has superseded, once the saved deck no longer
  // refers to it.
  router.delete('/:name', async (req, res) => {
    const target = resolve(assetsDir, req.params.name)
    if (!target.startsWith(assetsDir + sep) || req.params.name.startsWith('.')) {
      return res.status(400).json({ error: 'name must be a file in the deck assets folder' })
    }
    try {
      await unlink(target)
      res.json({ ok: true })
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: `no such asset: ${req.params.name}` })
      res.status(500).json({ error: String(err.message ?? err) })
    }
  })

  return router
}
