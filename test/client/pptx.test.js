// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { buildPptx } from '../../src/client/lib/pptx.js'

const decoder = new TextDecoder()

describe('PowerPoint snapshot export', () => {
  it('builds a presentation package with one related image per slide', () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const files = unzipSync(buildPptx([pixel, pixel], 960, 700))

    expect(Object.keys(files)).toContain('[Content_Types].xml')
    expect(Object.keys(files)).toContain('ppt/slides/slide1.xml')
    expect(Object.keys(files)).toContain('ppt/slides/slide2.xml')
    expect(files['ppt/media/image1.png'][0]).toBe(0x89)
    expect(decoder.decode(files['ppt/presentation.xml'])).toContain('<p:sldId id="257" r:id="rId2"/>')
    expect(decoder.decode(files['ppt/slides/_rels/slide1.xml.rels'])).toContain('../media/image1.png')
  })

  it('stores PNG parts uncompressed and releases each data URL', () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const images = [pixel]
    const bytes = buildPptx(images, 960, 700)

    expect(images).toEqual([null])
    // A stored (uncompressed) local file header carries method 0.
    const stored = []
    for (let at = 0; at < bytes.length - 4; at += 1) {
      if (bytes[at] === 0x50 && bytes[at + 1] === 0x4b && bytes[at + 2] === 0x03 && bytes[at + 3] === 0x04) {
        const nameLength = bytes[at + 26] | (bytes[at + 27] << 8)
        const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength))
        stored.push([name, bytes[at + 8] | (bytes[at + 9] << 8)])
      }
    }
    expect(stored).toContainEqual(['ppt/media/image1.png', 0])
    expect(stored.find(([name]) => name === '[Content_Types].xml')[1]).not.toBe(0)
  })
})
