import express from 'express'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

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

  return router
}
