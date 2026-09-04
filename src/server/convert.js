// Re-encode deck media the browser can't show: videos as WebM (VP9 + Opus)
// with the system `ffmpeg`, images as JPEG or PNG with ImageMagick. The
// browser-side codec sniffer tells the user *why* a video won't play; this
// is the fix. Videos run the same encoder settings the inspector shows for
// manual use (WEBM_ENCODE_ARGS), so the two paths can't drift apart.
import { execFile, spawn } from 'node:child_process'
import { readdir, rename, unlink } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { imageOutputName, isVideoPath, WEBM_ENCODE_ARGS } from '../client/lib/model/codecs.js'

export { imageOutputName }
export { isVideoPath as isVideoFile }

// Marks a conversion's in-progress output file. Dot-prefixed so the asset
// listing (which hides dot-files) never shows it mid-conversion, and
// distinctive enough that a leftover from a killed process can be found and
// removed on the next startup.
const PARTIAL_PREFIX = '.re-convert-'

/** Path of the temporary file a conversion to `output` writes while running. */
export function partialPath(output) {
  return join(dirname(output), `${PARTIAL_PREFIX}${basename(output)}`)
}

/**
 * Remove conversion temp files left in `assetsDir` by a process that never
 * reached rename-on-success or remove-on-failure (a crash or `kill -9`).
 * Logs each file removed; a removal failure is logged, not swallowed.
 * Does nothing if `assetsDir` doesn't exist yet.
 */
export async function cleanupPartials(assetsDir) {
  let entries
  try {
    entries = await readdir(assetsDir)
  } catch (err) {
    if (err.code === 'ENOENT') return
    console.error(`could not scan ${assetsDir} for leftover conversion files:`, err.message)
    return
  }
  for (const name of entries) {
    if (!name.startsWith(PARTIAL_PREFIX)) continue
    const path = join(assetsDir, name)
    try {
      await unlink(path)
      console.log(`removed leftover conversion file: ${path}`)
    } catch (err) {
      console.error(`could not remove leftover conversion file ${path}:`, err.message)
    }
  }
}

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
 * Transcode `input` to `output` (WebM). Writes to a dot-prefixed temporary
 * name next to `output` and renames on success, so a crash or abort never
 * leaves a half-written file under the final name (or visible in the asset
 * listing). `onProgress(fraction)` is called with values in [0, 1] as ffmpeg
 * reports encoded time. Rejects with ffmpeg's stderr tail on failure. The
 * returned promise has an `abort()` method that kills ffmpeg and removes the
 * partial output; the promise then rejects.
 */
export function convertToWebm({ input, output, onProgress = () => {}, bin = 'ffmpeg' }) {
  const partial = partialPath(output)
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

/**
 * The ImageMagick on PATH as `{ bin, version }` (bin is `magick` on
 * ImageMagick 7 and `convert` on 6), or null when there is none.
 */
export async function imageMagickVersion() {
  for (const bin of ['magick', 'convert']) {
    const version = await new Promise((resolvePromise) => {
      execFile(bin, ['-version'], { timeout: 5000 }, (err, stdout) => {
        if (err) return resolvePromise(null)
        const m = /^Version:\s*ImageMagick\s+(\S+)/.exec(String(stdout).split('\n')[0])
        resolvePromise(m ? m[1] : null)
      })
    })
    if (version) return { bin, version }
  }
  return null
}

/**
 * Convert `input` to `output` with ImageMagick. ImageMagick chooses the
 * output format from the extension, so the dot-prefixed temporary name keeps
 * it (`.re-convert-photo.jpg`); it is renamed onto `output` on success and
 * removed on failure. `input` is read as `<path>[0]`, taking the first frame
 * of a multi-page or layered file. Rejects with ImageMagick's stderr tail.
 * The returned promise has an `abort()` method that kills the conversion.
 */
export function convertImage({ input, output, bin = 'convert' }) {
  const partial = partialPath(output)
  const args = [`${input}[0]`, '-auto-orient']
  if (/\.jpe?g$/i.test(output)) args.push('-quality', '90')
  args.push(partial)
  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  let aborted = false
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024)
  })
  const promise = new Promise((resolvePromise, reject) => {
    child.on('error', (err) => reject(new Error(`could not run ${bin}: ${err.message}`)))
    child.on('close', async (code) => {
      if (aborted || code !== 0) {
        await unlink(partial).catch(() => {})
        const tail = stderr.trim().split('\n').slice(-6).join('\n')
        reject(new Error(aborted ? 'conversion aborted' : `${bin} exited with code ${code}\n${tail}`))
        return
      }
      try {
        await rename(partial, output)
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

/**
 * Whether the ffmpeg on PATH has the named encoder (`libsvtav1`, say).
 * False when ffmpeg itself is missing.
 */
export function hasFfmpegEncoder(name, bin = 'ffmpeg') {
  return new Promise((resolvePromise) => {
    execFile(bin, ['-hide_banner', '-encoders'], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolvePromise(false)
      resolvePromise(new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(String(stdout)))
    })
  })
}
