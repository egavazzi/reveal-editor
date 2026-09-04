// The media settings the self-contained HTML export offers. The table lives
// here, outside both the server encoder and the UI, so the descriptions the
// dialog shows and the numbers ffmpeg/ImageMagick run with are the same
// text.
//
// Every preset resizes a picture or a video to at most twice the size it is
// shown at in the deck, and never upscales. What varies is how hard the
// re-encode leans on the codec.

export const EXPORT_PRESETS = {
  original: {
    id: 'original',
    label: 'Original',
    description: 'Embed every file exactly as it is on disk.'
  },
  'near-lossless': {
    id: 'near-lossless',
    label: 'Near-lossless',
    description: 'Resize to twice the displayed size; PNG stays lossless, JPEG is only re-encoded when resized.',
    image: {
      jpegQuality: 93,
      // 4:4:4 keeps full chroma resolution, so a re-encode does not smear
      // coloured text and thin lines.
      samplingFactor: '4:4:4',
      photoPngToWebp: false,
      webpQuality: null
    },
    video: { vp9Crf: 22, av1Crf: 27 },
    // Mean SSIM the encode has to reach against the source, or the original
    // is embedded instead.
    ssimFloor: 0.98
  },
  compact: {
    id: 'compact',
    label: 'Compact',
    description: 'Same resizing, stronger compression: JPEG at quality 88, photographic PNGs as WebP, smaller video.',
    image: {
      jpegQuality: 88,
      samplingFactor: null,
      photoPngToWebp: true,
      webpQuality: 90
    },
    video: { vp9Crf: 30, av1Crf: 34 },
    ssimFloor: 0.95
  }
}

export const DEFAULT_EXPORT_PRESET = 'near-lossless'

export const EXPORT_CODECS = {
  vp9: {
    id: 'vp9',
    label: 'VP9',
    description: 'Plays in every current browser.'
  },
  av1: {
    id: 'av1',
    label: 'AV1',
    description: 'Smaller, needs a recent browser to play.'
  }
}

export const DEFAULT_EXPORT_CODEC = 'vp9'

// A re-encode has to win at least this fraction of the file to be used; below
// it, the quality is spent for nothing and the original is embedded.
export const MIN_EXPORT_SAVING = 0.1

/** The preset named `id`; throws for anything not in the table. */
export function exportPreset(id) {
  const preset = EXPORT_PRESETS[id]
  if (!preset) {
    throw new Error(`unknown export preset: ${JSON.stringify(id)} (known: ${Object.keys(EXPORT_PRESETS).join(', ')})`)
  }
  return preset
}

/** The codec named `id`; throws for anything not in the table. */
export function exportCodec(id) {
  const codec = EXPORT_CODECS[id]
  if (!codec) {
    throw new Error(`unknown video codec: ${JSON.stringify(id)} (known: ${Object.keys(EXPORT_CODECS).join(', ')})`)
  }
  return codec
}
