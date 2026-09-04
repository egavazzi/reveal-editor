async function jsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error ?? `${res.status} ${res.statusText}`)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

export async function fetchDeck() {
  return jsonOrThrow(await fetch('/api/deck'))
}

export async function putDeck(slidesHtml, baseMtimeMs) {
  return jsonOrThrow(await fetch('/api/deck', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slidesHtml, baseMtimeMs })
  }))
}

export async function uploadAsset(blob, name) {
  const params = new URLSearchParams({ name })
  return jsonOrThrow(await fetch(`/api/assets?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob
  }))
}

/** `{ assets }` — the deck's assets as `{ path, size }`, sorted by name. */
export async function listAssets() {
  return jsonOrThrow(await fetch('/api/assets'))
}

/**
 * `{ ffmpeg, imagemagick }` — the version of each converter the server can
 * run, or null for a tool that isn't installed.
 */
export async function converterStatus() {
  return jsonOrThrow(await fetch('/api/assets/convert'))
}

/**
 * Read an NDJSON job stream (`{progress}` lines, then a result or
 * `{error}`) from `res`. Resolves to the result line; rejects on an error
 * line or a stream that ends without one.
 */
async function readJobStream(res, onProgress) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let result = null
  const consume = (line) => {
    if (!line.trim()) return
    const msg = JSON.parse(line)
    if (msg.error) throw new Error(msg.error)
    if (typeof msg.progress === 'number') onProgress(msg.progress)
    else result = msg
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split('\n')
    buffered = lines.pop()
    lines.forEach(consume)
  }
  consume(buffered)
  if (!result) throw new Error('conversion ended without a result')
  return result
}

/**
 * Convert a deck asset (deck-relative `path`) on the server: videos to
 * WebM, images to JPEG or PNG. Resolves to the new deck-relative path;
 * `onProgress` receives fractions in [0, 1]. Aborting `signal` cancels the
 * conversion server-side.
 */
export async function convertAsset(path, { onProgress = () => {}, signal, fetchImpl = fetch } = {}) {
  const res = await fetchImpl('/api/assets/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    signal
  })
  if (!res.ok) return jsonOrThrow(res)
  return (await readJobStream(res, onProgress)).path
}

/**
 * Re-encode a deck asset smaller. Resolves to `{ path, before, after }` for
 * a replacement written under a new deck-relative path,
 * `{ kept: true, before, after }` when the saving was too small to be worth
 * it, or `{ skipped: true, reason }` for a format the server leaves alone.
 * `onProgress` receives fractions in [0, 1]; aborting `signal` stops the
 * encoder server-side.
 */
export async function optimizeAsset(path, options = {}, { onProgress = () => {}, signal, fetchImpl = fetch } = {}) {
  const res = await fetchImpl('/api/assets/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, options }),
    signal
  })
  if (!res.ok) return jsonOrThrow(res)
  return readJobStream(res, onProgress)
}

/** Delete one file from the deck's assets folder. */
export async function deleteAsset(name, { fetchImpl = fetch } = {}) {
  return jsonOrThrow(await fetchImpl(`/api/assets/${encodeURIComponent(name)}`, { method: 'DELETE' }))
}

export function subscribeEvents(onEvent) {
  const source = new EventSource('/api/events')
  source.onmessage = (e) => onEvent(JSON.parse(e.data))
  return () => source.close()
}
