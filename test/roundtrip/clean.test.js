// Runs in happy-dom (configured in vite.config.js) — exercises the
// client-side save cleaner against a DOM decorated with reveal.js runtime
// artifacts, the way the live deck looks at save time.
import { describe, expect, it } from 'vitest'
import { cleanSlides } from '../../src/client/lib/model/clean.js'
import { stashPristineState } from '../../src/client/lib/model/stash.js'

function makeSlides(innerHtml) {
  const el = document.createElement('div')
  el.className = 'slides'
  el.innerHTML = innerHtml
  return el
}

describe('cleanSlides', () => {
  it('strips reveal runtime classes/attrs from sections', () => {
    const slides = makeSlides(
      '<section class="present" hidden aria-hidden="true" data-fragment="0" style="display: block; top: 12px">' +
      '<h2>t</h2></section>'
    )
    const out = cleanSlides(slides)
    expect(out).toBe('<section><h2>t</h2></section>')
  })

  it('strips reveal background helper classes but keeps the background attrs', () => {
    const slides = makeSlides(
      '<section class="re-slide has-light-background present" data-background-color="#eef4fb"></section>'
    )
    const out = cleanSlides(slides)
    expect(out).toBe('<section class="re-slide" data-background-color="#eef4fb"></section>')
  })

  it('keeps authored section classes and styles', () => {
    const slides = makeSlides(
      '<section class="re-slide past" data-background-color="#001122" style="display: block; filter: blur(1px)"><h2>t</h2></section>'
    )
    const out = cleanSlides(slides)
    expect(out).toContain('class="re-slide"')
    expect(out).toContain('data-background-color="#001122"')
    expect(out).toContain('filter: blur(1px)')
    expect(out).not.toContain('display')
  })

  it('strips runtime fragment state, keeps authored indices', () => {
    const slides = makeSlides(
      '<section>' +
      '<p class="fragment visible current-fragment" data-fragment-index="0" data-re-frag-auto="">auto</p>' +
      '<p class="fragment visible" data-fragment-index="5">explicit</p>' +
      '</section>'
    )
    const out = cleanSlides(slides)
    expect(out).toContain('<p class="fragment">auto</p>')
    expect(out).toContain('<p class="fragment" data-fragment-index="5">explicit</p>')
  })

  it('restores code blocks from the pristine stash', () => {
    const src = 'function f(x)\n    return x\nend'
    const slides = makeSlides(
      `<section><pre class="re-el code-wrapper"><code class="language-julia hljs" tabindex="0" data-highlighted="yes" data-re-code-src="${src.replace(/\n/g, '&#10;')}">` +
      '<span class="hljs-keyword">function</span> f(x)…mangled…</code></pre></section>'
    )
    const out = cleanSlides(slides)
    expect(out).toContain(`<code class="language-julia">${src}</code>`)
    expect(out).toContain('<pre class="re-el">')
    expect(out).not.toContain('hljs')
    expect(out).not.toContain('code-wrapper')
    expect(out).not.toContain('tabindex')
    expect(out).not.toContain('data-re-code-src')
  })

  it('restores LaTeX source from KaTeX annotations', () => {
    const slides = makeSlides(
      '<section><p>inline <span class="katex"><math><annotation encoding="application/x-tex">E = mc^2</annotation></math>' +
      '<span class="katex-html">rendered</span></span> and</p>' +
      '<p><span class="katex-display"><span class="katex"><math><annotation encoding="application/x-tex">\\int_0^1 x</annotation></math>' +
      '<span class="katex-html">rendered</span></span></span></p></section>'
    )
    const out = cleanSlides(slides)
    expect(out).toContain('inline \\(E = mc^2\\) and')
    expect(out).toContain('$$\\int_0^1 x$$')
    expect(out).not.toContain('katex')
  })

  it('removes editor overlay elements', () => {
    const slides = makeSlides(
      '<section><h2>t</h2></section><div class="moveable-control-box">handles</div>'
    )
    expect(cleanSlides(slides)).toBe('<section><h2>t</h2></section>')
  })

  it('un-bakes reveal lazy loading for loaded media and source elements', () => {
    const slides = makeSlides(
      '<section>' +
      '<img src="assets/plot.png" data-lazy-loaded="">' +
      '<video data-lazy-loaded=""><source src="assets/movie.mp4" data-lazy-loaded=""></video>' +
      '</section>'
    )
    const out = cleanSlides(slides)
    expect(out).toContain('data-src="assets/plot.png"')
    expect(out).toContain('data-src="assets/movie.mp4"')
    expect(out).not.toContain('data-lazy-loaded')
    expect(out).not.toMatch(/<(?:img|source)[^>]*\ssrc=/)
  })
})

describe('rehydrate', () => {
  it('never re-stashes an already-live code block (paste-over-code regression)', async () => {
    const { rehydrate } = await import('../../src/client/lib/model/rehydrate.js')
    const bridge = { Reveal: { getPlugin: () => null }, win: {} }
    const section = document.createElement('section')
    section.innerHTML =
      '<pre><code class="language-julia" data-re-code-src="x = 1">' +
      '<span class="hljs-keyword">x</span> = 1</code></pre>'
    // simulates pasteElements rehydrating into a section with live code
    rehydrate(bridge, section)
    expect(section.querySelector('code').getAttribute('data-re-code-src')).toBe('x = 1')
  })
})

describe('stashPristineState', () => {
  it('pairs live and pristine code blocks and fragments by document order', () => {
    const pristine = `<!doctype html><html><body><div class="reveal"><div class="slides">
      <section><pre><code class="language-julia">x = 1</code></pre>
      <p class="fragment">no index</p>
      <p class="fragment" data-fragment-index="3">indexed</p></section>
    </div></div></body></html>`
    const live = makeSlides(
      '<section><pre><code class="language-julia hljs"><span>x</span> = 1</code></pre>' +
      '<p class="fragment" data-fragment-index="0">no index</p>' +
      '<p class="fragment" data-fragment-index="3">indexed</p></section>'
    )
    stashPristineState(live, pristine)
    const codes = live.querySelectorAll('code')
    expect(codes[0].getAttribute('data-re-code-src')).toBe('x = 1')
    const frags = live.querySelectorAll('.fragment')
    expect(frags[0].hasAttribute('data-re-frag-auto')).toBe(true)
    expect(frags[1].hasAttribute('data-re-frag-auto')).toBe(false)

    // and the cleaner should now produce the authored form
    const out = cleanSlides(live)
    expect(out).toContain('<code class="language-julia">x = 1</code>')
    expect(out).toContain('<p class="fragment">no index</p>')
    expect(out).toContain('data-fragment-index="3"')
  })
})
