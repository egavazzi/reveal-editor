// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { keynoteArchiveBytes, keynoteModelToReveal } from '../../src/client/lib/keynote.js'

const template = `<!doctype html><html><head><title>New presentation</title></head><body>
  <div class="reveal"><div class="slides"><section>old</section></div></div>
</body></html>`

const model = {
  kind: 'keynote',
  title: 'Imported talk',
  limitedPreview: false,
  diagnostics: ['Parsed fixture'],
  limits: ['Transitions are static'],
  scenes: [{
    id: 'slide-1', name: 'Opening', width: 960, height: 540,
    blocks: [{
      id: 'text-1', text: 'Hello Keynote', x: 20, y: 30, width: 400, height: 80,
      fontSize: 36, fontFamily: 'Helvetica Neue', color: 'rgba(1, 2, 3, 1)', bold: true
    }],
    objects: [{
      id: 'image-1', kind: 'image', x: 100, y: 150, width: 320, height: 180,
      mimeType: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    }],
    tables: [{
      id: 'table-1', x: 500, y: 100, width: 300, height: 150,
      rows: [['A', 'B'], ['1', '2']], headerRows: 1
    }],
    notes: ['Presenter note']
  }]
}

describe('Keynote import', () => {
  it('converts Keynote scenes to editable reveal-editor slides', () => {
    const converted = keynoteModelToReveal(model, template)
    const doc = new DOMParser().parseFromString(converted.html, 'text/html')
    const slide = doc.querySelector('.reveal .slides > section')

    expect(converted.title).toBe('Imported talk')
    expect(converted.slideCount).toBe(1)
    expect(slide.classList.contains('re-slide')).toBe(true)
    expect(slide.querySelector('.re-text').textContent).toBe('Hello Keynote')
    expect(slide.querySelector('img').getAttribute('src')).toBe('assets/keynote-slide-001-002.png')
    expect(slide.querySelector('table').textContent).toBe('AB12')
    expect(slide.querySelector('aside.notes').textContent).toBe('Presenter note')
    expect(doc.querySelector('template[data-re-settings]').innerHTML).toContain('"height": 540')
  })

  it('packages converted HTML and media as an importable reveal.js ZIP', () => {
    const converted = keynoteModelToReveal(model, template)
    const files = unzipSync(keynoteArchiveBytes(converted))
    expect(converted.assets.map((asset) => asset.path)).toEqual(['assets/keynote-slide-001-002.png'])
    expect(new TextDecoder().decode(files['deck.html'])).toContain('Hello Keynote')
    expect(files['assets/keynote-slide-001-002.png']).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  it('can make a browser-only deck with embedded media', () => {
    const converted = keynoteModelToReveal(model, template, { inlineAssets: true })
    expect(converted.html).toContain('data:image/png;base64,')
    expect(converted.assets).toEqual([])
  })
})
