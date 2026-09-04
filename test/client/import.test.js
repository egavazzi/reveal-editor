import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { readDeckZip } from '../../src/client/lib/import.js'

let consoleError
beforeAll(() => {
  window.happyDOM.settings.disableCSSFileLoading = true
  consoleError = vi.spyOn(console, 'error').mockImplementation((error, ...args) => {
    if (error?.name === 'NotSupportedError' && error.message?.includes('loading is disabled')) return
    console.warn(error, ...args)
  })
})
afterAll(() => consoleError.mockRestore())

function zipFile(files) {
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])))
  return new File([bytes], 'presentation.zip', { type: 'application/zip' })
}

describe('reveal.js ZIP import', () => {
  it('embeds nested, parent-relative, encoded, srcset and CSS assets', async () => {
    const html = await readDeckZip(zipFile({
      'package/talk/index.html': `<!doctype html><html><head><link rel="stylesheet" href="../styles/theme.css"></head><body>
        <div class="reveal"><div class="slides"><section data-background-image="./images/space%20photo.png">
          <img src="images/plot.png?cache=1" srcset="images/plot.png 1x, images/plot@2x.png 2x">
          <div style="background:url('../shared/grid.svg#tile')"></div>
        </section></div></div></body></html>`,
      'package/styles/theme.css': '@import "fonts.css"; body{background:url("../talk/images/plot.png")}',
      'package/styles/fonts.css': '@font-face{src:url(font.woff2)}',
      'package/styles/font.woff2': strToU8('font'),
      'package/talk/images/space photo.png': strToU8('space'),
      'package/talk/images/plot.png': strToU8('plot'),
      'package/talk/images/plot@2x.png': strToU8('plot2'),
      'package/shared/grid.svg': strToU8('<svg/>')
    }))

    expect(html).not.toMatch(/(?:src|href)="(?:\.\.\/|\.\/|images\/)/)
    expect(html.match(/data:image\/png;base64,/g)).toHaveLength(4)
    expect(html).toContain('data:image/svg+xml;base64,')
    expect(html).toContain('data:text/css;base64,')
    const css = atob(html.match(/data:text\/css;base64,([^"']+)/)[1])
    expect(css).toContain('data:font/woff2;base64,')
  })

  it('rejects a ZIP that has HTML but no reveal.js deck', async () => {
    await expect(readDeckZip(zipFile({ 'index.html': '<h1>Not a deck</h1>', 'image.png': strToU8('x') })))
      .rejects.toThrow('does not contain a reveal.js HTML presentation')
  })
})
