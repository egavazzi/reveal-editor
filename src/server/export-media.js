// Re-encode one deck file for the self-contained HTML export. The result is
// written to a scratch directory and embedded in the exported HTML; the file
// in assets/ is read and never written, so the deck folder always holds the
// originals.
//
// Two guards decide whether an encode is used at all: it has to save at
// least MIN_EXPORT_SAVING of the file, and (for video) reach the preset's
// mean SSIM against the source. Failing either, the caller embeds the
// original.
import { spawn } from 'node:child_process'
import { readFile, rename, stat, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { WEBM_ENCODE_ARGS, extensionOf, isVideoPath } from '../client/lib/model/codecs.js'
import { MIN_EXPORT_SAVING, exportCodec } from '../client/lib/model/export-presets.js'
import { contentAddressedName, stripHashSuffix } from './asset-names.js'
import { parseDuration, parseOutTime } from './convert.js'

// Formats no encoder here improves: SVG is text, and the rest are formats a
// browser cannot display anyway (they reach a deck only through the editor's
// conversion, which has already written a PNG or JPEG).
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

/**
 * Run `bin` with `args`, rejecting with the tool's stderr tail on a non-zero
 * exit. `onStderr` sees the accumulated stderr (the ffmpeg banner carries the
 * duration) and `onStdout` each `-progress` chunk. The returned promise has
 * `abort()`.
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
      if (aborted) return reject(new Error('export encoding aborted'))
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-6).join('\n')
        return reject(new Error(`${bin} exited with code ${code}\n${tail}`))
      }
      resolvePromise(stderr)
    })
  })
  promise.abort = () => {
    aborted = true
    child.kill('SIGKILL')
  }
  return promise
}

/** Collected stdout of `bin args`, rejecting like `runTool`. */
async function toolOutput(bin, args) {
  let out = ''
  await runTool(bin, args, { onStdout: (chunk) => { out += chunk } })
  return out
}

/** ImageMagick's `identify` as `[bin, leadingArgs]` for either major version. */
function identifyCommand(magickBin) {
  return magickBin === 'magick' ? ['magick', ['identify']] : ['identify', []]
}

/**
 * The size `source` shrinks to so that it fits inside `target`, or null when
 * it already does — media is never upscaled. Both sides are rounded to an
 * even number of pixels, which VP9 and AV1 require.
 */
export function fitWithin(source, target) {
  if (!target || !(target.width > 0) || !(target.height > 0)) return null
  if (!(source.width > 0) || !(source.height > 0)) return null
  const scale = Math.min(target.width / source.width, target.height / source.height)
  if (scale >= 1) return null
  // rounded down, so a fitted size never exceeds the target box
  const even = (value) => Math.max(2, 2 * Math.floor(value / 2))
  return { width: even(source.width * scale), height: even(source.height * scale) }
}

/**
 * ImageMagick arguments that write `output` from `input`, resized to `size`
 * when one is given. PNG keeps its exact pixels (maximum compression, no
 * metadata); JPEG and WebP are re-encoded at the preset's quality.
 */
export function imageExportArgs({ input, output, size = null, quality = null, samplingFactor = null }) {
  const args = [`${input}[0]`, '-auto-orient']
  if (size) args.push('-resize', `${size.width}x${size.height}!`)
  args.push('-strip')
  if (/\.(jpe?g|webp)$/i.test(output)) args.push('-quality', String(quality))
  if (samplingFactor && /\.jpe?g$/i.test(output)) args.push('-sampling-factor', samplingFactor)
  if (/\.webp$/i.test(output)) args.push('-define', 'webp:method=6')
  if (/\.png$/i.test(output)) args.push('-define', 'png:compression-level=9')
  args.push(output)
  return args
}

/**
 * ffmpeg arguments that re-encode `input` to WebM at `crf`, scaled to `size`
 * when one is given, with the metadata dropped and the frame rate kept.
 * `audio` false produces a silent file. `-progress pipe:1` drives the
 * progress reporting.
 */
export function videoExportArgs({ input, output, size = null, crf, codec = 'vp9', audio = true }) {
  const video = codec === 'av1'
    ? ['-c:v', 'libsvtav1', '-crf', String(crf), '-preset', '6']
    : (() => {
        const encode = [...WEBM_ENCODE_ARGS]
        encode[encode.indexOf('-crf') + 1] = String(crf)
        // audio is appended below, uniformly for both codecs
        return encode.slice(0, encode.indexOf('-c:a'))
      })()
  return [
    '-nostdin', '-hide_banner', '-y',
    '-i', input,
    ...(size ? ['-vf', `scale=${size.width}:${size.height}:flags=lanczos`] : []),
    ...video,
    ...(audio ? ['-c:a', 'libopus'] : ['-an']),
    '-map_metadata', '-1',
    '-f', 'webm',
    '-progress', 'pipe:1', '-nostats',
    output
  ]
}

/**
 * ffmpeg arguments that measure `encoded` against `source`, scaling the
 * source to `size` first so the two have the same frame geometry.
 */
export function ssimArgs({ encoded, source, size }) {
  return [
    '-nostdin', '-hide_banner',
    '-i', encoded, '-i', source,
    '-filter_complex',
    `[1:v]scale=${size.width}:${size.height}:flags=lanczos,format=yuv420p[ref];` +
    '[0:v]format=yuv420p[enc];[enc][ref]ssim',
    '-an', '-f', 'null', '-'
  ]
}

/** The mean SSIM ffmpeg's `ssim` filter reported, or null when it printed none. */
export function parseMeanSsim(stderr) {
  const matches = String(stderr).match(/All:\s*([0-9]*\.?[0-9]+)/g)
  if (!matches) return null
  return Number(matches[matches.length - 1].replace(/All:\s*/, ''))
}

/** `mean_volume` from ffmpeg's `volumedetect`, in dBFS, or null. */
export function parseMeanVolume(stderr) {
  const m = /mean_volume:\s*(-?[0-9]*\.?[0-9]+) dB/.exec(String(stderr))
  return m ? Number(m[1]) : null
}

// Below this mean level a track carries no audible sound, and dropping it
// saves the bytes an Opus stream of silence would still cost.
const SILENCE_DBFS = -70

/** File name of `path` without its extension. */
function baseStem(path) {
  const name = path.split(/[/\\]/).pop() ?? path
  return name.slice(0, name.length - extname(name).length) || name
}

/** `width`, `height`, colour count and alpha of an image, via ImageMagick. */
async function imageInfo(input, magickBin) {
  const [bin, lead] = identifyCommand(magickBin)
  const out = await toolOutput(bin, [...lead, '-format', '%w %h %k %A %n\n', `${input}[0]`])
  const [width, height, colors, alpha, frames] = out.trim().split('\n')[0].split(/\s+/)
  return {
    width: Number(width),
    height: Number(height),
    colors: Number(colors),
    hasAlpha: /^(true|blend)$/i.test(alpha),
    frames: Number(frames) || 1
  }
}

/** Frame count of a (possibly animated) image, via ImageMagick. */
async function frameCount(input, magickBin) {
  const [bin, lead] = identifyCommand(magickBin)
  const out = await toolOutput(bin, [...lead, '-format', '%n\n', input])
  const lines = out.trim().split('\n').filter(Boolean)
  // ImageMagick reports %n per frame; both the count and the line count say
  // how many there are, and the larger is the safe answer.
  return Math.max(lines.length, Number(lines[0]) || 1)
}

/** `width`, `height` and whether an audible audio track is present. */
async function videoInfo(input, ffprobeBin, ffmpegBin) {
  const out = await toolOutput(ffprobeBin, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', input
  ])
  const [width, height] = out.trim().split('\n')[0].split(',').map(Number)
  if (!(width > 0) || !(height > 0)) throw new Error(`ffprobe found no video stream in ${input}`)
  const audioStreams = (await toolOutput(ffprobeBin, [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', input
  ])).trim()
  let audio = audioStreams !== ''
  if (audio) {
    const stderr = await runTool(ffmpegBin, [
      '-nostdin', '-hide_banner', '-i', input, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'
    ])
    const mean = parseMeanVolume(stderr)
    if (mean !== null && mean <= SILENCE_DBFS) audio = false
  }
  return { width, height, audio }
}

/**
 * Re-encode `input` into `outDir` for an export at `preset` (an entry of
 * EXPORT_PRESETS), fitting it inside `target` pixels. Resolves to one of:
 *
 * - `{ path, before, after, ssim? }` — a smaller file was written; `path` is
 *   its name inside `outDir`.
 * - `{ kept, before, after, reason, ssim? }` — the encode ran but is not
 *   worth using, so it was discarded and the original should be embedded.
 * - `{ skipped, reason }` — the file is embedded as it is, without encoding.
 *
 * Rejects when a tool is missing or exits non-zero. The returned promise has
 * `abort()`.
 */
export function exportMedia({
  input, outDir, preset, codec = 'vp9', target = null,
  onProgress = () => {}, ffmpegBin = 'ffmpeg', ffprobeBin = 'ffprobe', magickBin = 'convert'
}) {
  exportCodec(codec)
  let job = null
  let aborted = false
  const track = (next) => {
    job = next
    if (aborted) next.abort()
    return next
  }

  const promise = (async () => {
    if (!preset?.video) return { skipped: true, reason: 'the original was asked for' }
    const before = (await stat(input)).size

    const finish = async (partial, extra = {}) => {
      const after = (await stat(partial)).size
      if (after > before * (1 - MIN_EXPORT_SAVING)) {
        await unlink(partial)
        return { kept: true, before, after, reason: 'less than 10% smaller', ...extra }
      }
      const ext = extname(partial)
      const bytes = await readFile(partial)
      const name = contentAddressedName(stripHashSuffix(baseStem(input)) + ext, bytes, { ext })
      await rename(partial, join(outDir, name))
      return { path: name, before, after, ...extra }
    }

    const encodeVideo = async (source, { audio }) => {
      const info = source.info
      const size = fitWithin(info, target)
      const partial = join(outDir, `.encoding-${process.pid}-${Date.now()}.webm`)
      const crf = codec === 'av1' ? preset.video.av1Crf : preset.video.vp9Crf
      try {
        let duration = null
        await track(runTool(ffmpegBin, videoExportArgs({
          input: source.path, output: partial, size, crf, codec, audio
        }), {
          onStderr: (stderr) => { if (duration === null) duration = parseDuration(stderr) },
          onStdout: (chunk) => {
            const t = parseOutTime(chunk)
            // the SSIM pass still has to run, so encoding is not the whole job
            if (t !== null && duration) onProgress(0.9 * Math.min(1, Math.max(0, t / duration)))
          }
        }))
        const measured = size ?? info
        const stderr = await track(runTool(ffmpegBin, ssimArgs({
          encoded: partial, source: source.path, size: measured
        })))
        onProgress(1)
        const ssim = parseMeanSsim(stderr)
        if (ssim === null) throw new Error(`ffmpeg reported no SSIM for ${input}`)
        if (ssim < preset.ssimFloor) {
          const after = (await stat(partial)).size
          await unlink(partial)
          return { kept: true, before, after, ssim, reason: 'ssim below threshold' }
        }
        return await finish(partial, { ssim })
      } catch (err) {
        await unlink(partial).catch(() => {})
        throw err
      }
    }

    if (isVideoPath(input)) {
      const info = await videoInfo(input, ffprobeBin, ffmpegBin)
      return encodeVideo({ path: input, info }, { audio: info.audio })
    }

    const ext = extensionOf(input)
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      return { skipped: true, reason: ext === 'svg' ? 'vector image' : `format left as it is: .${ext || 'none'}` }
    }
    if (/[[\]]/.test(input)) {
      throw new Error('file names containing [ or ] cannot be re-encoded; rename the file')
    }

    if (ext === 'gif' && (await frameCount(input, magickBin)) > 1) {
      // An animation compresses far better as video than as a GIF, and the
      // exporter turns the <img> into a looping muted <video> to play it.
      const info = await videoInfo(input, ffprobeBin, ffmpegBin)
      const result = await encodeVideo({ path: input, info }, { audio: false })
      return result.path ? { ...result, video: true } : result
    }

    const info = await imageInfo(input, magickBin)
    const size = fitWithin(info, target)
    const photoPng = ext === 'png' && !info.hasAlpha && info.colors > 256
    const toWebp = preset.image.photoPngToWebp && photoPng
    const outExt = toWebp ? '.webp' : (ext === 'jpeg' ? '.jpg' : `.${ext}`)
    // A lossy source that is already at the size it is shown at would only
    // lose quality to another pass through the encoder.
    if (!size && !toWebp && (ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif')) {
      return { skipped: true, reason: 'already at the size it is shown at' }
    }
    const partial = join(outDir, `.encoding-${process.pid}-${Date.now()}${outExt}`)
    try {
      await track(runTool(magickBin, imageExportArgs({
        input,
        output: partial,
        size,
        quality: toWebp ? preset.image.webpQuality : preset.image.jpegQuality,
        samplingFactor: preset.image.samplingFactor
      })))
      onProgress(1)
      return await finish(partial)
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
