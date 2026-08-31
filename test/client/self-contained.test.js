import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildSelfContainedHtml } from '../../src/client/lib/self-contained.js'

let consoleError
beforeAll(() => {
  window.happyDOM.settings.disableCSSFileLoading = true
  window.happyDOM.settings.disableIframePageLoading = true
  window.happyDOM.settings.disableJavaScriptFileLoading = true
  window.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true
  const original = console.error
  consoleError = vi.spyOn(console, 'error').mockImplementation((error, ...args) => {
    if (error?.name === 'NotSupportedError' && error.message?.includes('loading is disabled')) return
    original(error, ...args)
  })
})
afterAll(() => consoleError.mockRestore())

function response(body, type) {
  return new Response(body, { status: 200, headers: { 'Content-Type': type } })
}

describe('self-contained HTML export', () => {
  it('embeds scripts, recursive CSS assets, media, inline styles and iframes', async () => {
    const resources = new Map([
      ['https://example.test/deck/style.css', response(
        '@import "theme.css"; .hero{background:url("texture.png")}', 'text/css')],
      ['https://example.test/deck/theme.css', response(
        '@font-face{font-family:x;src:url(font.woff2)}', 'text/css')],
      ['https://example.test/deck/texture.png', response('texture', 'image/png')],
      ['https://example.test/deck/font.woff2', response('font', 'font/woff2')],
      ['https://example.test/deck/inline.png', response('inline', 'image/png')],
      ['https://example.test/deck/app.js', response('window.embeddedScript = true;', 'text/javascript')],
      ['https://example.test/deck/photo.png', response('photo', 'image/png')],
      ['https://example.test/deck/poster.jpg', response('poster', 'image/jpeg')],
      ['https://example.test/deck/movie.mp4', response('movie', 'video/mp4')],
      ['https://example.test/deck/frame.html', response(
        '<!doctype html><html><body><img src="inside.png"></body></html>', 'text/html')],
      ['https://example.test/deck/inside.png', response('inside', 'image/png')]
    ])
    const fetchImpl = vi.fn(async (url) => {
      const found = resources.get(url)
      if (!found) return new Response('', { status: 404 })
      return found.clone()
    })
    const progress = []
    const html = await buildSelfContainedHtml({
      baseUrl: 'https://example.test/deck/deck.html?editmode=1',
      fetchImpl,
      onProgress: (state) => progress.push(state),
      slidesHtml: '<section><h2>Current unsaved slide</h2></section>',
      html: `<!doctype html><html><head>
        <link rel="stylesheet" href="style.css">
        <style>.inline { background-image: url(inline.png) }</style>
      </head><body><div class="reveal"><div class="slides"><section>Old</section></div></div>
        <img src="photo.png"><video src="movie.mp4" poster="poster.jpg"></video>
        <iframe src="frame.html"></iframe><script src="app.js"></script>
      </body></html>`
    })

    expect(html).toContain('Current unsaved slide')
    expect(html).not.toContain('<section>Old</section>')
    expect(html).not.toMatch(/<(?:link|script)[^>]+(?:href|src)="(?:style|app)\./)
    expect(html).toContain('window.embeddedScript = true;')
    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain('data:image/jpeg;base64,')
    expect(html).toContain('data:video/mp4;base64,')
    expect(html).toContain('data:font/woff2;base64,')
    expect(html).toContain('data:text/html;base64,')
    expect(fetchImpl).toHaveBeenCalledTimes(resources.size)
    expect(progress.at(-1).done).toBe(progress.at(-1).total)
  })

  it('fails rather than silently leaving an unavailable resource external', async () => {
    await expect(buildSelfContainedHtml({
      html: '<html><body><div class="reveal"><div class="slides"></div></div><img src="private.png"></body></html>',
      baseUrl: 'https://example.test/deck.html',
      fetchImpl: async () => new Response('', { status: 403 })
    })).rejects.toThrow('could not fetch https://example.test/private.png (403)')
  })
})
