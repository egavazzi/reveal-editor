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
    expect(html).toContain('data:text/css;base64,')
    const css = atob(html.match(/data:text\/css;base64,([^"']+)/)[1])
    expect(css).toContain('data:font/woff2;base64,')
    // The fragment picks one symbol out of the SVG and has to survive.
    expect(html).toMatch(/data:image\/svg\+xml;base64,[^"'#]+#tile/)
  })

  it('separates srcset candidates that are not followed by a space', async () => {
    const html = await readDeckZip(zipFile({
      'index.html': `<!doctype html><html><body><div class="reveal"><div class="slides"><section>
        <img srcset="a.png 1x,b.png 2x">
      </section></div></div></body></html>`,
      'a.png': strToU8('a'),
      'b.png': strToU8('b')
    }))
    const srcset = new DOMParser().parseFromString(html, 'text/html').querySelector('img').getAttribute('srcset')
    expect(srcset.split(', ')).toHaveLength(2)
    expect(srcset).not.toContain('a.png')
    expect(srcset).not.toContain('b.png')
  })

  it('resolves root-relative paths against the ZIP top-level directory', async () => {
    const html = await readDeckZip(zipFile({
      'package/talk/index.html': `<!doctype html><html><head><link rel="stylesheet" href="/dist/reveal.css"></head>
        <body><div class="reveal"><div class="slides"><section><img src="/media/plot.png"></section></div></div></body></html>`,
      'package/dist/reveal.css': '.reveal{}',
      'package/media/plot.png': strToU8('plot')
    }))
    expect(html).toContain('data:text/css;base64,')
    expect(html).toContain('data:image/png;base64,')
  })

  it('refuses an archive whose assets it cannot resolve', async () => {
    await expect(readDeckZip(zipFile({
      'index.html': `<!doctype html><html><body><div class="reveal"><div class="slides">
        <section><img src="images/plot.png"></section></div></div></body></html>`
    }))).rejects.toThrow('The presentation references files that are not in it: images/plot.png')
  })

  it('does not let a reference climb out of the archive', async () => {
    // `new URL(value, 'https://zip.invalid/…')` clamps at the origin root, so
    // the reference resolves to `etc/passwd`, which no entry is named.
    await expect(readDeckZip(zipFile({
      'package/talk/index.html': `<!doctype html><html><body><div class="reveal"><div class="slides">
        <section><img src="../../etc/passwd"></section></div></div></body></html>`,
      '../../etc/passwd': strToU8('root:x:0:0')
    }))).rejects.toThrow('references files that are not in it: ../../etc/passwd')
  })

  it('refuses a cyclic @import chain', async () => {
    await expect(readDeckZip(zipFile({
      'index.html': `<!doctype html><html><head><link rel="stylesheet" href="a.css"></head>
        <body><div class="reveal"><div class="slides"><section>x</section></div></div></body></html>`,
      'a.css': '@import url("b.css");',
      'b.css': '@import "a.css";'
    }))).rejects.toThrow('@import cycle: a.css -> b.css -> a.css')
  })

  it('rejects a ZIP that has HTML but no reveal.js deck', async () => {
    await expect(readDeckZip(zipFile({ 'index.html': '<h1>Not a deck</h1>', 'image.png': strToU8('x') })))
      .rejects.toThrow('does not contain a reveal.js HTML presentation')
  })
})
