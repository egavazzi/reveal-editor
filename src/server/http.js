// Request helpers shared by the routers: resolving a deck-relative path a
// client sent, and streaming a long-running encoder job.
import { resolve, sep } from 'node:path'

/**
 * The file inside `deckDir` that `relPath` (as written in a `<video src>`)
 * names, or null for anything outside the deck folder or remote.
 */
export function resolveDeckFile(deckDir, relPath) {
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

/**
 * Stream a job as newline-delimited JSON: `{"progress": f}` lines while it
 * runs, then one result line built by `finish` from the job's value, or
 * `{"error": "…"}`. `makeJob(send)` returns a promise with `abort()`;
 * closing the request kills the tool and removes the partial output.
 */
export async function streamJob(res, makeJob, finish, label) {
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
    console.error(`encoding ${label} failed:`, err.message)
    send({ error: String(err.message ?? err) })
  }
  res.end()
}

/**
 * Throttle a progress callback to whole percents: ffmpeg reports several
 * times a second and every line would otherwise become an NDJSON write.
 */
export function percentProgress(send) {
  let lastSent = -1
  return (fraction) => {
    const pct = Math.floor(fraction * 100)
    if (pct !== lastSent) {
      lastSent = pct
      send({ progress: pct / 100 })
    }
  }
}
