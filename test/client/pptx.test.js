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
})
