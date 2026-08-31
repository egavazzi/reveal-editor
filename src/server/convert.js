// Re-encode a deck video as WebM (VP9 + Opus) with the system `ffmpeg`.
// The browser-side codec sniffer tells the user *why* a video won't play;
// this is the fix. It runs the same encoder settings the inspector shows
// for manual use (WEBM_ENCODE_ARGS), so the two paths can't drift apart.
import { execFile, spawn } from 'node:child_process'
import { rename, unlink } from 'node:fs/promises'
import { WEBM_ENCODE_ARGS } from '../client/lib/model/codecs.js'

/** Version of the ffmpeg on PATH (e.g. "6.1.1"), or null when there is none. */
export function ffmpegVersion(bin = 'ffmpeg') {
  return new Promise((resolvePromise) => {
    execFile(bin, ['-version'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolvePromise(null)
      const line = String(stdout).split('\n')[0]
      resolvePromise(line.replace(/^ffmpeg version\s+/, '').split(' ')[0] || line)
    })
  })
}

/** `Duration: HH:MM:SS.ss` from ffmpeg's stderr banner, in seconds, or null. */
export function parseDuration(stderr) {
  const m = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(stderr)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/**
 * Latest `out_time_us=` value from a `-progress` stream, in seconds, or null.
 * (`out_time_ms` is also in microseconds despite its name; `out_time_us` is
 * the unambiguous key and is emitted alongside it.)
 */
export function parseOutTime(progress) {
  const matches = progress.match(/out_time_us=(-?\d+)/g)
  if (!matches) return null
  const last = matches[matches.length - 1]
  return Number(last.slice('out_time_us='.length)) / 1e6
}

/**
 * Transcode `input` to `output` (WebM). Writes to `<output>.part` and renames
 * on success, so a crash or abort never leaves a half-written file under the
 * final name. `onProgress(fraction)` is called with values in [0, 1] as
 * ffmpeg reports encoded time. Rejects with ffmpeg's stderr tail on failure.
 * The returned promise has an `abort()` method that kills ffmpeg and removes
 * the partial output; the promise then rejects.
 */
export function convertToWebm({ input, output, onProgress = () => {}, bin = 'ffmpeg' }) {
  const partial = `${output}.part`
  const args = [
    '-nostdin', '-hide_banner', '-y',
    '-i', input,
    ...WEBM_ENCODE_ARGS,
    '-f', 'webm',
    '-progress', 'pipe:1', '-nostats',
    partial
  ]
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  let duration = null
  let aborted = false
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024)
    if (duration === null) duration = parseDuration(stderr)
  })
  child.stdout.on('data', (chunk) => {
    const t = parseOutTime(chunk)
    if (t !== null && duration) onProgress(Math.min(1, Math.max(0, t / duration)))
  })
  const promise = new Promise((resolvePromise, reject) => {
    child.on('error', (err) => reject(new Error(`could not run ${bin}: ${err.message}`)))
    child.on('close', async (code) => {
      if (aborted || code !== 0) {
        await unlink(partial).catch(() => {})
        const tail = stderr.trim().split('\n').slice(-6).join('\n')
        reject(new Error(aborted ? 'conversion aborted' : `ffmpeg exited with code ${code}\n${tail}`))
        return
      }
      try {
        await rename(partial, output)
        onProgress(1)
        resolvePromise()
      } catch (err) {
        reject(err)
      }
    })
  })
  promise.abort = () => {
    aborted = true
    child.kill('SIGKILL')
  }
  return promise
}
