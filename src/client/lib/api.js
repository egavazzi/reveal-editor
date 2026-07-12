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

export function subscribeEvents(onEvent) {
  const source = new EventSource('/api/events')
  source.onmessage = (e) => onEvent(JSON.parse(e.data))
  return () => source.close()
}
