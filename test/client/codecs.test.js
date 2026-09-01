// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  extensionOf, imageOutputName, isImagePath, isVideoPath,
  sniffVideoCodec, probeVideoCodec, webmConvertCommand
} from '../../src/client/lib/model/codecs.js'

const bytesOf = (text) => Uint8Array.from(text, (ch) => ch.charCodeAt(0))

function mp4Bytes(fourcc) {
  // minimal shape: [size][ftyp][brands…] then unrelated data containing the fourcc
  const ftyp = '\0\0\0\x14ftypisom\0\0\0\x01avc1'
  return bytesOf(`${ftyp}\0\0\0\x30moovtrakmdiaminfstblstsd${fourcc}rest`)
}

describe('codec sniffing', () => {
  it('identifies common video codecs by sample-entry fourcc', () => {
    expect(sniffVideoCodec(mp4Bytes('hvc1')).id).toBe('hevc')
    expect(sniffVideoCodec(mp4Bytes('mp4v')).id).toBe('mpeg4')
    expect(sniffVideoCodec(mp4Bytes('av01')).id).toBe('av1')
    expect(sniffVideoCodec(mp4Bytes('apch')).id).toBe('prores')
  })

  it('identifies matroska/webm codec ids', () => {
    expect(sniffVideoCodec(bytesOf('....V_MPEGH/ISO/HEVC....')).id).toBe('hevc')
    expect(sniffVideoCodec(bytesOf('....V_VP9....')).id).toBe('vp9')
  })

  it('ignores codec brands inside the ftyp box', () => {
    // ftyp advertises avc1 compatibility but the track is mpeg4
    const bytes = mp4Bytes('mp4v')
    expect(sniffVideoCodec(bytes).id).toBe('mpeg4')
    // and a file whose ONLY avc1 mention is the ftyp brand is not H.264
    const ftypOnly = bytesOf('\0\0\0\x14ftypisom\0\0\0\x01avc1' + 'no codec markers here')
    expect(sniffVideoCodec(ftypOnly)).toBe(null)
  })

  it('probes the tail when the head has no codec marker (moov at end)', async () => {
    const calls = []
    const fetchImpl = async (url, { headers }) => {
      calls.push(headers.Range)
      const body = headers.Range.startsWith('bytes=-') ? mp4Bytes('hvc1') : bytesOf('mdat only here')
      return { ok: true, arrayBuffer: async () => body.buffer }
    }
    const hit = await probeVideoCodec('/assets/a.mov', { fetchImpl })
    expect(hit.id).toBe('hevc')
    expect(calls).toEqual(['bytes=0-262143', 'bytes=-524288'])
  })

  it('returns null on fetch failure', async () => {
    const fetchImpl = async () => ({ ok: false, status: 404 })
    expect(await probeVideoCodec('/x', { fetchImpl })).toBe(null)
  })

  it('classifies files by extension', () => {
    expect(extensionOf('a/b/My Clip.MOV')).toBe('mov')
    expect(extensionOf('noextension')).toBe('')
    expect(isVideoPath('assets/clip.mov')).toBe(true)
    expect(isVideoPath('assets/photo.heic')).toBe(false)
    expect(isImagePath('assets/photo.HEIC')).toBe(true)
    expect(isImagePath('assets/clip.mp4')).toBe(false)
  })

  it('names the converted copy of an image', () => {
    expect(imageOutputName('IMG_1234.heic')).toBe('IMG_1234.jpg')
    expect(imageOutputName('scan.tiff')).toBe('scan.png')
    expect(imageOutputName('assets/layers.psd')).toBe('assets/layers.png')
  })

  it('builds the conversion command from the file name', () => {
    expect(webmConvertCommand('my video.mov'))
      .toBe('ffmpeg -i "my video.mov" -c:v libvpx-vp9 -crf 32 -b:v 0 -c:a libopus "my video.webm"')
    expect(webmConvertCommand('')).toContain('input.mp4')
  })
})
