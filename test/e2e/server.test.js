// @vitest-environment node
// Boots the real Express server against a scaffolded deck in a temp dir and
// exercises the full HTTP surface: deck round-trip, conflict detection,
// asset upload with dedupe.
import { mkdtemp, readFile, rm, utimes } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../../src/server/index.js'
import { scaffoldDeck } from '../../src/server/scaffold.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

// node's built-in fetch (undici) silently ignores attempts to override the
// Host header, so spoofing it for the DNS-rebinding test requires the raw
// http client instead.
function requestWithHost({ port, path, method, host, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Host: host,
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
        }
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode, body: data }))
      }
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

let dir, deckPath, server, base

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reveal-editor-test-'))
  deckPath = await scaffoldDeck(join(dir, 'deck'))
  const started = await createServer({ deckPath, port: 0, dev: false, repoRoot })
  server = started.server
  base = started.url
})

afterAll(async () => {
  server?.close()
  await rm(dir, { recursive: true, force: true })
})

describe('server e2e', () => {
  it('serves the editor UI and the deck same-origin', async () => {
    expect((await fetch(base)).status).toBe(200)
    expect((await fetch(`${base}deck/deck.html`)).status).toBe(200)
    expect((await fetch(`${base}deck/reveal/dist/reveal.js`)).status).toBe(200)
  })

  it('GET /api/deck returns the file and mtime', async () => {
    const body = await (await fetch(`${base}api/deck`)).json()
    expect(body.file).toBe('deck.html')
    expect(body.html).toContain('<div class="slides">')
    expect(body.mtimeMs).toBeTypeOf('number')
  })

  it('PUT round-trip: no-op save leaves the file byte-identical', async () => {
    const before = await readFile(deckPath, 'utf8')
    const { html, mtimeMs } = await (await fetch(`${base}api/deck`)).json()
    const inner = html.match(/<div class="slides">([\s\S]*?)\n    <\/div>/)[1]
    const res = await fetch(`${base}api/deck`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slidesHtml: inner, baseMtimeMs: mtimeMs })
    })
    expect(res.status).toBe(200)
    expect(await readFile(deckPath, 'utf8')).toBe(before)
  })

  it('PUT with stale mtime returns 409 and does not write', async () => {
    const before = await readFile(deckPath, 'utf8')
    // pretend the client loaded long ago
    const res = await fetch(`${base}api/deck`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slidesHtml: '<section><h2>clobber</h2></section>', baseMtimeMs: 12345 })
    })
    expect(res.status).toBe(409)
    expect(await readFile(deckPath, 'utf8')).toBe(before)
  })

  it('rejects requests with a non-local Host header (DNS rebinding guard)', async () => {
    const before = await readFile(deckPath, 'utf8')
    const port = server.address().port
    const res = await requestWithHost({
      port,
      path: '/api/deck',
      method: 'PUT',
      host: 'evil.example.com',
      body: JSON.stringify({ slidesHtml: '<section><h2>clobber</h2></section>' })
    })
    expect(res.status).toBe(403)
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid Host header' })
    expect(await readFile(deckPath, 'utf8')).toBe(before)
  })

  it('PUT applies edits and formats deterministically', async () => {
    const { mtimeMs } = await (await fetch(`${base}api/deck`)).json()
    const res = await fetch(`${base}api/deck`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slidesHtml:
          '<section class="re-slide"><h2 style="top: 40px; left: 60px; position: absolute">Results</h2></section>',
        baseMtimeMs: mtimeMs
      })
    })
    expect(res.status).toBe(200)
    const after = await readFile(deckPath, 'utf8')
    expect(after).toContain(
      '<h2 style="position: absolute; left: 60px; top: 40px">Results</h2>'
    )
    // head/scripts untouched
    expect(after).toContain('katex: { local: \'reveal/katex\' }')
  })

  it('uploads assets with content-hash dedupe', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const upload = () =>
      fetch(`${base}api/assets?name=fig.png`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: png
      }).then((r) => r.json())
    const first = await upload()
    const second = await upload()
    expect(first.path).toMatch(/^assets\/fig-[0-9a-f]{8}\.png$/)
    expect(second.path).toBe(first.path)
    const listing = await (await fetch(`${base}api/assets`)).json()
    expect(listing.assets).toEqual([first.path])
  })

  it('rejects path traversal in asset names', async () => {
    const res = await fetch(`${base}api/assets?name=../../evil.sh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array([1])
    })
    const body = await res.json()
    expect(body.path ?? '').not.toContain('..')
  })

  it('does not expose filesystem scaffolding over HTTP', async () => {
    const res = await fetch(`${base}api/deck/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: '../../outside-the-deck' })
    })
    expect(res.status).toBe(404)
  })
})
