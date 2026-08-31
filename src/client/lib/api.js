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

export async function listAssets() {
  return jsonOrThrow(await fetch('/api/assets'))
}

/** `{ available, version }` — whether the server can re-encode videos. */
export async function ffmpegStatus() {
  return jsonOrThrow(await fetch('/api/assets/convert'))
}

/**
 * Re-encode a deck video (deck-relative `path`) as WebM on the server.
 * Resolves to the new deck-relative path; `onProgress` receives fractions
 * in [0, 1]. Aborting `signal` cancels the encode server-side.
 */
export async function convertAssetToWebm(path, { onProgress = () => {}, signal, fetchImpl = fetch } = {}) {
  const res = await fetchImpl('/api/assets/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    signal
  })
  if (!res.ok) return jsonOrThrow(res)
  // newline-delimited JSON: progress lines, then a final path or error line
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let result = null
  const consume = (line) => {
    if (!line.trim()) return
    const msg = JSON.parse(line)
    if (msg.error) throw new Error(msg.error)
    if (msg.path) result = msg.path
    else if (typeof msg.progress === 'number') onProgress(msg.progress)
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

export function subscribeEvents(onEvent) {
  const source = new EventSource('/api/events')
  source.onmessage = (e) => onEvent(JSON.parse(e.data))
  return () => source.close()
}
