// Recompress deck media in place of the originals: images through
// ImageMagick, videos through ffmpeg to the same WebM (VP9 + Opus) settings
// the conversion path uses. The goal is a smaller deck — and a much smaller
// self-contained HTML export — at a quality the audience cannot tell apart,
// so an encode that does not save at least `minSaving` of the file is thrown
// away and the original kept.
import { spawn } from 'node:child_process'
import { readFile, rename, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { WEBM_ENCODE_ARGS, extensionOf, isVideoPath } from '../client/lib/model/codecs.js'
import { parseDuration, parseOutTime, partialPath } from './convert.js'
import { contentAddressedName, stripHashSuffix } from './asset-names.js'

export const OPTIMIZE_DEFAULTS = Object.freeze({
  // longer side, in pixels; a 2560 px image still looks sharp on a 4K screen
  maxDimension: 2560,
  imageQuality: 85,
  imageFormat: 'keep',
  videoCrf: 32,
  minSaving: 0.1
})

// Formats an optimizer would damage rather than shrink: SVG is text the
// encoders cannot improve, and a GIF re-encode loses the animation.
const SKIP_EXTENSIONS = {
  svg: 'vector image',
  gif: 'GIF (animation would be lost)'
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

function requireNumber(name, value, { min, max, integer = false }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a number, got ${JSON.stringify(value)}`)
  }
  if (integer && !Number.isInteger(value)) throw new Error(`${name} must be a whole number, got ${value}`)
  if (value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}, got ${value}`)
  return value
}

/**
 * Fill in the defaults and reject anything the encoders cannot act on. An
 * unknown key is an error rather than a silently ignored setting, so a typo
 * in a caller never quietly optimizes with the defaults.
 */
export function normalizeOptimizeOptions(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('options must be an object')
  }
  for (const key of Object.keys(options)) {
    if (!(key in OPTIMIZE_DEFAULTS)) {
      throw new Error(`unknown option: ${key} (known: ${Object.keys(OPTIMIZE_DEFAULTS).join(', ')})`)
    }
  }
  const merged = { ...OPTIMIZE_DEFAULTS, ...options }
  requireNumber('maxDimension', merged.maxDimension, { min: 16, max: 16384, integer: true })
  requireNumber('imageQuality', merged.imageQuality, { min: 1, max: 100, integer: true })
  requireNumber('videoCrf', merged.videoCrf, { min: 0, max: 63, integer: true })
  requireNumber('minSaving', merged.minSaving, { min: 0, max: 0.95 })
  if (merged.imageFormat !== 'keep' && merged.imageFormat !== 'webp') {
    throw new Error(`imageFormat must be 'keep' or 'webp', got ${JSON.stringify(merged.imageFormat)}`)
  }
  return merged
}

/** How `path` is optimized: 'video', 'image', or null for a format we skip. */
export function optimizeKind(path) {
  if (isVideoPath(path)) return 'video'
  return IMAGE_EXTENSIONS.includes(extensionOf(path)) ? 'image' : null
}

/** Why `path` is left alone, or null when it can be optimized. */
export function skipReason(path) {
  const ext = extensionOf(path)
  if (SKIP_EXTENSIONS[ext]) return SKIP_EXTENSIONS[ext]
  if (optimizeKind(path)) return null
  return `unsupported format: .${ext || 'none'}`
}

/**
 * ffmpeg scale filter that caps the LONGER side at `maxDimension` and never
 * upscales. Both branches round to an even size, which VP9 requires.
 */
export function videoScaleFilter(maxDimension) {
  const cap = `min(${maxDimension},%s)`
  const even = (expr) => `2*floor((${expr})/2)`
  const w = `if(gte(iw,ih),${even(cap.replace('%s', 'iw'))},-2)`
  const h = `if(gte(iw,ih),-2,${even(cap.replace('%s', 'ih'))})`
  return `scale=w='${w}':h='${h}'`
}

/**
 * ffmpeg arguments that re-encode `input` to WebM at `crf`, scaled to
 * `maxDimension` and stripped of metadata. `-progress pipe:1` drives the
 * progress reporting.
 */
export function videoOptimizeArgs({ input, output, crf, maxDimension }) {
  const encode = [...WEBM_ENCODE_ARGS]
  encode[encode.indexOf('-crf') + 1] = String(crf)
  return [
    '-nostdin', '-hide_banner', '-y',
    '-i', input,
    '-vf', videoScaleFilter(maxDimension),
    ...encode,
    '-map_metadata', '-1',
    '-f', 'webm',
    '-progress', 'pipe:1', '-nostats',
    output
  ]
}

/** Extension the optimized copy of `input` gets. */
export function optimizeOutputExtension(input, { imageFormat } = {}) {
  if (optimizeKind(input) === 'video') return '.webm'
  if (imageFormat === 'webp') return '.webp'
  const ext = extensionOf(input)
  return ext === 'jpeg' ? '.jpg' : `.${ext}`
}

/**
 * ImageMagick arguments that resize `input` to fit `maxDimension` (the `>`
 * flag makes it shrink-only) and write `output`. JPEG and WebP get the
 * quality setting; PNG keeps its lossless pixels and is only resized and
 * stripped of metadata.
 */
export function imageOptimizeArgs({ input, output, quality, maxDimension }) {
  const args = [`${input}[0]`, '-auto-orient', '-resize', `${maxDimension}x${maxDimension}>`, '-strip']
  if (/\.(jpe?g|webp)$/i.test(output)) args.push('-quality', String(quality))
  if (/\.webp$/i.test(output)) args.push('-define', 'webp:method=6')
  if (/\.png$/i.test(output)) args.push('-define', 'png:compression-level=9')
  args.push(output)
  return args
}

/**
 * Run `bin` with `args`, rejecting with the tool's stderr tail on a non-zero
 * exit. `onStderr` sees every chunk (the ffmpeg banner carries the duration)
 * and `onStdout` the `-progress` stream. The returned promise has `abort()`.
 */
function runTool(bin, args, { onStdout = () => {}, onStderr = () => {} } = {}) {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  let aborted = false
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024)
    onStderr(stderr)
  })
  child.stdout.on('data', onStdout)
  const promise = new Promise((resolvePromise, reject) => {
    child.on('error', (err) => reject(new Error(`could not run ${bin}: ${err.message}`)))
    child.on('close', (code) => {
      if (aborted) return reject(new Error('optimization aborted'))
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-6).join('\n')
        return reject(new Error(`${bin} exited with code ${code}\n${tail}`))
      }
      resolvePromise()
    })
  })
  promise.abort = () => {
    aborted = true
    child.kill('SIGKILL')
  }
  return promise
}

/** Number of frames/pages in `input` according to ImageMagick, or null. */
async function frameCount(input, bin) {
  let out = ''
  const job = runTool(bin === 'magick' ? 'magick' : 'identify', [
    ...(bin === 'magick' ? ['identify'] : []), '-format', '%n\n', input
  ], { onStdout: (chunk) => { out += chunk } })
  try {
    await job
  } catch {
    return null
  }
  const first = Number(out.trim().split('\n')[0])
  return Number.isFinite(first) ? first : null
}

/**
 * Re-encode one deck asset and store the result under its content-addressed
 * name in `assetsDir`. Resolves to one of:
 *
 * - `{ path, before, after }` — a smaller file was written; `path` is its
 *   name inside `assetsDir`. The input is left on disk for the caller to
 *   remove once nothing references it.
 * - `{ kept: true, before, after }` — the re-encode did not save
 *   `minSaving` of the file, so it was discarded.
 * - `{ skipped: true, reason }` — the format is one we do not touch.
 *
 * Rejects when a tool is missing, exits non-zero, or the format is unknown.
 * The returned promise has `abort()`.
 */
export function optimizeAsset({
  input, assetsDir, options = {}, onProgress = () => {},
  ffmpegBin = 'ffmpeg', magickBin = 'convert'
}) {
  const settings = normalizeOptimizeOptions(options)
  const reason = skipReason(input)
  let job = null
  let aborted = false
  const promise = (async () => {
    if (reason) {
      if (!optimizeKind(input) && !SKIP_EXTENSIONS[extensionOf(input)]) throw new Error(reason)
      return { skipped: true, reason }
    }
    const kind = optimizeKind(input)
    if (kind === 'image' && /[[\]]/.test(input)) {
      throw new Error('file names containing [ or ] cannot be optimized; rename the file')
    }
    if (kind === 'image' && settings.imageFormat === 'webp') {
      const frames = await frameCount(input, magickBin)
      if (frames !== null && frames > 1) {
        return { skipped: true, reason: 'animated image' }
      }
    }
    const before = (await stat(input)).size
    const ext = optimizeOutputExtension(input, settings)
    const partial = partialPath(join(assetsDir, `optimize-${process.pid}-${Date.now()}${ext}`))
    try {
      if (kind === 'video') {
        let duration = null
        job = runTool(ffmpegBin, videoOptimizeArgs({
          input, output: partial, crf: settings.videoCrf, maxDimension: settings.maxDimension
        }), {
          onStderr: (stderr) => { if (duration === null) duration = parseDuration(stderr) },
          onStdout: (chunk) => {
            const t = parseOutTime(chunk)
            if (t !== null && duration) onProgress(Math.min(1, Math.max(0, t / duration)))
          }
        })
      } else {
        job = runTool(magickBin, imageOptimizeArgs({
          input, output: partial, quality: settings.imageQuality, maxDimension: settings.maxDimension
        }))
      }
      if (aborted) job.abort()
      await job
      onProgress(1)
      const after = (await stat(partial)).size
      if (after > before * (1 - settings.minSaving)) {
        await unlink(partial)
        return { kept: true, before, after }
      }
      const bytes = await readFile(partial)
      const stem = stripHashSuffix(baseStem(input))
      const name = contentAddressedName(stem + ext, bytes, { ext })
      const target = join(assetsDir, name)
      if (existsSync(target)) await unlink(partial)
      else await rename(partial, target)
      return { path: name, before, after }
    } catch (err) {
      await unlink(partial).catch(() => {})
      throw err
    }
  })()
  promise.abort = () => {
    aborted = true
    job?.abort()
  }
  return promise
}

/** File name of `path` without its extension. */
function baseStem(path) {
  const name = path.split(/[/\\]/).pop() ?? path
  return name.slice(0, name.length - extname(name).length) || name
}
