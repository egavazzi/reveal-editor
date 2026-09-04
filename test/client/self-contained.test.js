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
  it('refuses a cyclic @import chain instead of recursing forever', async () => {
    const resources = new Map([
      ['https://example.test/deck/a.css', () => response('@import "b.css";', 'text/css')],
      ['https://example.test/deck/b.css', () => response('@import "a.css";', 'text/css')]
    ])
    await expect(buildSelfContainedHtml({
      html: '<html><head><link rel="stylesheet" href="a.css"></head><body></body></html>',
      baseUrl: 'https://example.test/deck/deck.html',
      fetchImpl: async (url) => resources.get(url)()
    })).rejects.toThrow('@import cycle: a.css -> b.css -> a.css')
  })

  it('embeds backgrounds, multi-source background video and svg sprite uses', async () => {
    const seen = []
    const fetchImpl = vi.fn(async (url) => {
      seen.push(url)
      if (url.endsWith('.svg')) return response('<svg/>', 'image/svg+xml')
      if (url.endsWith('.webm')) return response('webm', 'video/webm')
      if (url.endsWith('.mp4')) return response('mp4', 'video/mp4')
      return response('image', 'image/png')
    })
    const html = await buildSelfContainedHtml({
      html: `<html><body><div class="reveal"><div class="slides">
        <section data-background="#ff0000"></section>
        <section data-background="rgba(0, 0, 0, .5)"></section>
        <section data-background="black"></section>
        <section data-background="cover.png"></section>
        <section data-background-video="clip.webm, clip.mp4"></section>
        <svg><use href="sprite.svg#icon"></use></svg>
        <img srcset="one.png 1x,two.png 2x">
        <div style="background:url('grid.svg#tile')"></div>
      </div></div></body></html>`,
      baseUrl: 'https://example.test/deck/deck.html',
      fetchImpl
    })

    const doc = new DOMParser().parseFromString(html, 'text/html')
    const backgrounds = [...doc.querySelectorAll('[data-background]')].map((el) => el.getAttribute('data-background'))
    expect(backgrounds.slice(0, 3)).toEqual(['#ff0000', 'rgba(0, 0, 0, .5)', 'black'])
    expect(backgrounds[3]).toMatch(/^data:image\/png;base64,/)
    expect(doc.querySelector('[data-background-video]').getAttribute('data-background-video'))
      .toMatch(/^data:video\/webm;base64,[^,]+,data:video\/mp4;base64,/)
    // Fragments select a piece of the file and must survive embedding.
    expect(doc.querySelector('use').getAttribute('href')).toMatch(/^data:image\/svg\+xml;base64,[^#]+#icon$/)
    expect(doc.querySelector('div[style]').getAttribute('style')).toMatch(/#tile"\)/)
    const candidates = doc.querySelector('img').getAttribute('srcset').split(', ')
    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatch(/^data:image\/png;base64,\S+ 1x$/)
    expect(seen).not.toContain('https://example.test/deck/sprite.svg#icon')
  })

  it('builds each embedded resource once however often it is referenced', async () => {
    const fetchImpl = vi.fn(async () => response('logo', 'image/png'))
    await buildSelfContainedHtml({
      html: `<html><body><div class="reveal"><div class="slides">
        <img src="logo.png"><img src="logo.png"><img src="logo.png?v=1">
      </div></div></body></html>`,
      baseUrl: 'https://example.test/deck/deck.html',
      fetchImpl
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops once the embedded resources exceed the export budget', async () => {
    await expect(buildSelfContainedHtml({
      html: '<html><body><div class="reveal"><div class="slides"><img src="huge.png"></div></div></body></html>',
      baseUrl: 'https://example.test/deck/deck.html',
      fetchImpl: async () => response('x'.repeat(4096), 'image/png'),
      maxBytes: 1024
    })).rejects.toThrow('embedding huge.png would exceed the 0 MB export budget')
  })

  it('refuses a MathJax deck rather than exporting a CDN dependency', async () => {
    await expect(buildSelfContainedHtml({
      html: `<html><body><div class="reveal"><div class="slides"></div></div>
        <script>Reveal.initialize({ plugins: [RevealMath.MathJax3] })<\/script></body></html>`,
      baseUrl: 'https://example.test/deck/deck.html',
      fetchImpl: async () => response('', 'text/plain')
    })).rejects.toThrow('MathJax decks cannot be exported self-contained; switch the deck to KaTeX')
  })

  it('refuses an external module script, whose imports cannot be inlined', async () => {
    await expect(buildSelfContainedHtml({
      html: '<html><head><script type="module" src="app.js"><\/script></head><body></body></html>',
      baseUrl: 'https://example.test/deck/deck.html',
      fetchImpl: async () => response('export {}', 'text/javascript')
    })).rejects.toThrow('external module scripts cannot be embedded: app.js')
  })

  it('moves a deferred head script to the end of the body', async () => {
    const html = await buildSelfContainedHtml({
      html: `<html><head><script defer src="late.js"><\/script>
        <script src="early.js"><\/script></head><body><p>body</p></body></html>`,
      baseUrl: 'https://example.test/deck/deck.html',
      fetchImpl: async (url) => response(url.includes('late') ? 'LATE' : 'EARLY', 'text/javascript')
    })
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.head.textContent).toContain('EARLY')
    expect(doc.head.textContent).not.toContain('LATE')
    expect(doc.body.lastElementChild.textContent).toBe('LATE')
  })

  it('exports the theme the editor is showing, not the one on disk', async () => {
    const fetched = []
    const html = await buildSelfContainedHtml({
      html: '<html><head><link rel="stylesheet" href="dist/theme/black.css"></head><body></body></html>',
      baseUrl: 'https://example.test/deck/deck.html',
      themeHref: 'https://example.test/deck/dist/theme/dracula.css',
      fetchImpl: async (url) => {
        fetched.push(url)
        return response('.theme{}', 'text/css')
      }
    })
    expect(fetched).toEqual(['https://example.test/deck/dist/theme/dracula.css'])
    expect(html).not.toContain('black.css')
  })

  it('reports progress that never goes backwards', async () => {
    const progress = []
    await buildSelfContainedHtml({
      html: `<html><head><link rel="stylesheet" href="style.css"></head><body>
        <img src="a.png"><img src="b.png"><img src="c.png"></body></html>`,
      baseUrl: 'https://example.test/deck/deck.html',
      fetchImpl: async (url) => (url.endsWith('.css')
        ? response('.x{background:url(d.png)}', 'text/css')
        : response('image', 'image/png')),
      onProgress: (state) => progress.push(state)
    })
    const percentages = progress.map((state) => state.done / state.total)
    expect(percentages.length).toBeGreaterThan(3)
    for (let i = 1; i < percentages.length; i += 1) {
      expect(percentages[i]).toBeGreaterThanOrEqual(percentages[i - 1])
    }
    expect(percentages.at(-1)).toBe(1)
  })
})

describe('export copies', () => {
  it('embeds the copy the export encoder produced instead of the original', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/export/media/photo-1234abcd.jpg') return response('smaller', 'image/jpeg')
      if (url === 'https://example.test/deck/logo.svg') return response('<svg/>', 'image/svg+xml')
      return new Response('', { status: 404 })
    })
    const html = await buildSelfContainedHtml({
      html: '<html><body><img src="photo.png"><img src="logo.svg"></body></html>',
      baseUrl: 'https://example.test/deck/deck.html',
      fetchImpl,
      replacements: new Map([
        ['https://example.test/deck/photo.png', { url: '/api/export/media/photo-1234abcd.jpg', video: false }]
      ])
    })
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/api/export/media/photo-1234abcd.jpg',
      'https://example.test/deck/logo.svg'
    ])
    expect(html).toContain('data:image/jpeg;base64,')
    expect(html).not.toContain('photo.png')
  })

  it('plays an animation whose copy is a video as a looping muted video', async () => {
    const html = await buildSelfContainedHtml({
      html: '<html><body><img class="re-el" src="spin.gif" alt="a spinner" style="width: 100px"></body></html>',
      baseUrl: 'https://example.test/deck/deck.html',
      fetchImpl: async () => response('webm bytes', 'video/webm'),
      replacements: new Map([
        ['https://example.test/deck/spin.gif', { url: '/api/export/media/spin-1234abcd.webm', video: true }]
      ])
    })
    expect(html).not.toContain('<img')
    expect(html).toMatch(/<video[^>]*class="re-el"/)
    expect(html).toMatch(/<video[^>]*style="width: 100px"/)
    for (const flag of ['autoplay', 'loop', 'muted', 'playsinline']) expect(html).toContain(flag)
    expect(html).toContain('data:video/webm;base64,')
  })
})
