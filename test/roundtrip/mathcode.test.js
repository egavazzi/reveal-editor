// Runs in happy-dom — exercises the math/code source editors against the
// rendered (KaTeX / highlighted) live DOM form.
import { describe, expect, it } from 'vitest'
import { isMathOnly, commitCode } from '../../src/client/lib/editors/mathcode.js'

// A minimal stand-in for a rendered inline KaTeX node: the cleaner restores
// the delimited TeX from the MathML annotation.
function katex(tex) {
  return (
    '<span class="katex"><span class="katex-mathml">' +
    `<math><semantics><annotation encoding="application/x-tex">${tex}</annotation>` +
    '</semantics></math></span></span>'
  )
}

function el(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.firstElementChild
}

describe('isMathOnly', () => {
  it('is true for text + math with no other markup', () => {
    const p = el(`<p>E = ${katex('E=mc^2')}</p>`)
    expect(isMathOnly(p)).toBe(true)
  })

  it('is false when the element carries rich markup around the math', () => {
    const p = el(`<p>The <b>famous</b> ${katex('E=mc^2')}</p>`)
    expect(isMathOnly(p)).toBe(false)
  })
})

// commitCode needs only Reveal.getPlugin; no highlight plugin here.
const bridge = { Reveal: { getPlugin: () => undefined } }

describe('commitCode', () => {
  it('preserves authored classes while swapping the language class', () => {
    const pre = el('<pre><code class="fancy language-python hljs">old</code></pre>')
    commitCode(bridge, pre, 'x = 1', 'julia')
    const code = pre.querySelector('code')
    expect(code.classList.contains('fancy')).toBe(true)
    expect(code.classList.contains('language-julia')).toBe(true)
    expect(code.classList.contains('language-python')).toBe(false)
    expect(code.classList.contains('hljs')).toBe(false)
    expect(code.textContent).toBe('x = 1')
  })

  it('drops the class attribute entirely when nothing remains', () => {
    const pre = el('<pre><code class="language-python hljs">old</code></pre>')
    commitCode(bridge, pre, 'x = 1', '')
    expect(pre.querySelector('code').hasAttribute('class')).toBe(false)
  })
})
