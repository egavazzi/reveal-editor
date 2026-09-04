// Media re-encoding for the self-contained HTML export. Everything written
// here lands in `<deck>/.re-export/` — dot-prefixed, so the asset listing
// and the deck's static mount both ignore it — and the client fetches the
// results back through this router. assets/ is only ever read.
import express from 'express'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isVideoPath } from '../client/lib/model/codecs.js'
import { exportPreset } from '../client/lib/model/export-presets.js'
import { ffmpegVersion, hasFfmpegEncoder, imageMagickVersion } from './convert.js'
import { exportMedia } from './export-media.js'
import { percentProgress, resolveDeckFile, streamJob } from './http.js'

export const EXPORT_DIR = '.re-export'

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function readTarget(value) {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('target must be an object')
  const { width, height } = value
  for (const [name, size] of [['width', width], ['height', height]]) {
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      throw new Error(`target.${name} must be a positive number, got ${JSON.stringify(size)}`)
    }
  }
  return { width, height }
}

export async function exportRouter(deckDir) {
  const router = express.Router()
  const outDir = resolve(deckDir, EXPORT_DIR)
  // Whatever an interrupted export left behind is worthless: the exported
  // HTML carries its own copy of every byte it needed.
  await rm(outDir, { recursive: true, force: true }).catch((err) => {
    console.error(`could not remove the leftover export folder ${outDir}:`, err.message)
  })

  // Re-encode one deck file for an export, streaming `{"progress": f}` lines
  // and ending in `{path, before, after, ssim?}` for a copy worth embedding,
  // `{kept, before, after, reason, ssim?}` when the encode was not worth its
  // quality, `{skipped, before, reason}` for a file embedded as it is, or
  // `{error}`. `path` is the URL this router serves the copy from.
  router.post('/media', async (req, res) => {
    const input = resolveDeckFile(deckDir, req.body?.path)
    if (!input) return res.status(400).json({ error: 'path must point inside the deck folder' })
    if (!existsSync(input)) return res.status(404).json({ error: `no such file: ${req.body.path}` })

    let preset, target
    const codec = req.body?.codec ?? 'vp9'
    try {
      preset = exportPreset(req.body?.preset)
      target = readTarget(req.body?.target)
    } catch (err) {
      return res.status(400).json({ error: String(err.message ?? err) })
    }
    if (codec !== 'vp9' && codec !== 'av1') {
      return res.status(400).json({ error: `unknown video codec: ${JSON.stringify(codec)} (known: vp9, av1)` })
    }

    if (preset.id === 'original') return res.json({ skipped: true, reason: 'the original was asked for' })

    const wantsVideo = isVideoPath(input) || /\.gif$/i.test(input)
    if (wantsVideo && (await ffmpegVersion()) === null) {
      return res.status(501).json({ error: 'ffmpeg is not installed on this machine' })
    }
    if (wantsVideo && codec === 'av1' && !(await hasFfmpegEncoder('libsvtav1'))) {
      return res.status(501).json({
        error: 'this machine\'s ffmpeg has no libsvtav1 encoder; export with VP9 or install an ffmpeg built with SVT-AV1'
      })
    }
    const magick = await imageMagickVersion()
    if (!isVideoPath(input) && !magick) {
      return res.status(501).json({ error: 'ImageMagick is not installed on this machine' })
    }
    await mkdir(outDir, { recursive: true })

    return streamJob(res, (send) => exportMedia({
      input,
      outDir,
      preset,
      codec,
      target,
      magickBin: magick?.bin ?? 'convert',
      onProgress: percentProgress(send)
    }), (result) => (result.path ? { ...result, path: `/api/export/media/${result.path}` } : result), req.body.path)
  })

  // Fetch one re-encoded copy. The exporter reads it straight into the HTML
  // it is building; nothing else may reach into the folder.
  router.get('/media/:name', (req, res) => {
    if (!SAFE_NAME.test(req.params.name)) {
      return res.status(400).json({ error: 'name must be a file this export produced' })
    }
    const file = join(outDir, req.params.name)
    if (!existsSync(file)) return res.status(404).json({ error: `no such export file: ${req.params.name}` })
    // the folder is dot-prefixed, which express would otherwise refuse to serve
    res.sendFile(file, { dotfiles: 'allow' })
  })

  // Drop everything the export produced. The client calls this when the
  // export finishes, successfully or not.
  router.delete('/media', async (req, res) => {
    try {
      await rm(outDir, { recursive: true, force: true })
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err.message ?? err) })
    }
  })

  return router
}
