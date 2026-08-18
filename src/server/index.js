import express from 'express'
import { cp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { loadDeck, saveDeck } from './deck.js'
import { assetsRouter } from './assets.js'
import { watchDeck } from './watch.js'

/**
 * Keep the deck's vendored copy of the repo's custom themes
 * (templates/themes/) current: add missing files and refresh outdated ones.
 * The repo is authoritative for these — a stale copy in a deck causes
 * subtle mixed-version rendering (old theme CSS with new layouts). Decks
 * that don't use a custom theme are unaffected; stock reveal themes are
 * never touched.
 */
async function syncCustomThemes(deckDir, repoRoot) {
  const source = join(repoRoot, 'templates', 'themes')
  const target = join(deckDir, 'reveal', 'dist', 'theme')
  if (!existsSync(source) || !existsSync(target)) return
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) {
      // font/asset dirs: idempotent recursive copy (upstream-versioned files)
      await cp(from, to, { recursive: true, force: true })
    } else if (entry.name.endsWith('.css')) {
      const fresh = await readFile(from, 'utf8')
      const current = existsSync(to) ? await readFile(to, 'utf8') : null
      if (current === fresh) continue
      await writeFile(to, fresh, 'utf8')
      console.log(`${current === null ? 'added' : 'updated'} custom theme ${entry.name} in ${target}`)
    }
  }
}

export async function createServer({ deckPath, port = 3737, dev = false, repoRoot }) {
  const app = express()
  const deckDir = dirname(deckPath)
  const deckFile = basename(deckPath)
  await syncCustomThemes(deckDir, repoRoot).catch(() => {})

  // --- Host header validation (defense against DNS rebinding) ---
  const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
  app.use((req, res, next) => {
    const host = req.headers.host ?? ''
    const hostname = host.toLowerCase().replace(/:\d+$/, '')
    if (!ALLOWED_HOSTS.has(hostname)) {
      return res.status(403).json({ error: 'invalid Host header' })
    }
    next()
  })

  app.use(express.json({ limit: '50mb' }))

  // --- API ---
  app.get('/api/deck', async (req, res) => {
    try {
      const { html, mtimeMs } = await loadDeck(deckPath)
      res.json({ file: deckFile, html, mtimeMs })
    } catch (err) {
      res.status(500).json({ error: String(err.message ?? err) })
    }
  })

  app.put('/api/deck', async (req, res) => {
    const { slidesHtml, baseMtimeMs } = req.body ?? {}
    if (typeof slidesHtml !== 'string') {
      return res.status(400).json({ error: 'missing slidesHtml' })
    }
    try {
      const current = await stat(deckPath)
      if (baseMtimeMs != null && Math.abs(current.mtimeMs - baseMtimeMs) > 1) {
        return res.status(409).json({ error: 'deck changed on disk', mtimeMs: current.mtimeMs })
      }
      const { mtimeMs } = await saveDeck(deckPath, slidesHtml)
      res.json({ ok: true, mtimeMs })
    } catch (err) {
      res.status(500).json({ error: String(err.message ?? err) })
    }
  })

  app.use('/api/assets', assetsRouter(deckDir))

  app.get('/api/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.flushHeaders()
    const unsubscribe = watchDeck(deckPath, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    })
    req.on('close', unsubscribe)
  })

  // --- Deck folder (same-origin iframe source) ---
  app.use('/deck', express.static(deckDir, { fallthrough: false, index: false }))

  // --- Editor UI ---
  if (dev) {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      configFile: join(repoRoot, 'vite.config.js'),
      server: { middlewareMode: true },
      appType: 'spa'
    })
    app.use(vite.middlewares)
  } else {
    const dist = join(repoRoot, 'dist')
    if (!existsSync(join(dist, 'index.html'))) {
      throw new Error(`Editor UI not built (${dist} missing). Run: npm run build — or use --dev.`)
    }
    // no-cache: revalidate on every load (cheap 304s), so a rebuilt dist/
    // is never shadowed by a heuristically-cached editor bundle
    app.use(express.static(dist, {
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
    }))
    app.get('/{*any}', async (req, res) => {
      res.set('Cache-Control', 'no-cache')
      res.type('html').send(await readFile(join(dist, 'index.html'), 'utf8'))
    })
  }

  const server = await new Promise((resolvePromise, reject) => {
    // Express 5 invokes the listen callback even on failure, passing the
    // error as its first argument (the server never binds and address()
    // stays null) — so the error must be handled here, not only via the
    // 'error' event.
    const s = app.listen(port, '127.0.0.1', (err) => {
      if (err) reject(err)
      else resolvePromise(s)
    })
    s.on('error', reject)
  })

  const url = `http://127.0.0.1:${server.address().port}/`
  return { app, server, url }
}
