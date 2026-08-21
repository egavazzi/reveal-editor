// @vitest-environment happy-dom
// Mixing prose and LaTeX in one text box: the file (and the box while it is
// being edited) holds delimited source; the live slide holds rendered KaTeX.
import { beforeEach, describe, expect, it } from 'vitest'
import { restoreMath, cleanElementHtml } from '../../src/client/lib/model/clean.js'
import { startTextEdit, stopTextEdit, insertInlineMath } from '../../src/client/lib/editors/text.js'

// Rendered inline KaTeX, as auto-render leaves it: the .katex tree (which
// carries the original TeX in a MathML annotation) inside an anonymous,
// attribute-less wrapper span that auto-render created to hold it.
function rendered(tex, display = false) {
  const katex =
    '<span class="katex"><span class="katex-mathml">' +
    `<math><semantics><annotation encoding="application/x-tex">${tex}</annotation>` +
    `</semantics></math></span><span class="katex-html">${tex}</span></span>`
  return `<span>${display ? `<span class="katex-display">${katex}</span>` : katex}</span>`
}

function el(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.firstElementChild
}

// Stand-in for the deck's KaTeX auto-render: rewrites delimited source found
// in text nodes into the same shape the real renderer produces.
function fakeRenderMathInElement(root) {
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (!child.classList.contains('katex')) walk(child)
        continue
      }
      if (child.nodeType !== 3) continue
      const html = child.data
        .replace(/\$\$(.+?)\$\$/g, (_, tex) => rendered(tex, true))
        .replace(/\\\((.+?)\\\)/g, (_, tex) => rendered(tex))
        .replace(/\$(.+?)\$/g, (_, tex) => rendered(tex))
      if (html === child.data) continue
      const tmp = document.createElement('div')
      tmp.innerHTML = html
      child.replaceWith(...tmp.childNodes)
    }
  }
  walk(root)
}

const bridge = () => ({
  doc: document,
  win: window,
  config: () => ({})
})

describe('restoreMath on mixed prose and math', () => {
  it('restores the delimited source around the surrounding text', () => {
    const p = el(`<p class="re-text">Einstein wrote ${rendered('E=mc^2')} in 1905.</p>`)
    restoreMath(p)
    expect(p.textContent).toBe('Einstein wrote \\(E=mc^2\\) in 1905.')
    expect(p.querySelector('*')).toBeNull()
  })

  it('takes the renderer wrapper with it, so spans never accumulate', () => {
    const p = el('<p class="re-text">Let \\(x\\) be positive.</p>')
    const before = p.innerHTML
    for (let i = 0; i < 3; i++) {
      fakeRenderMathInElement(p)
      restoreMath(p)
      expect(p.innerHTML).toBe(before)
    }
  })

  it('keeps a wrapper the author wrote themselves', () => {
    const p = el(`<p class="re-text">a <span class="hl">${rendered('x')}</span> b</p>`)
    restoreMath(p)
    expect(p.innerHTML).toBe('a <span class="hl">\\(x\\)</span> b')
  })

  it('restores display math with $$ delimiters', () => {
    const p = el(`<p class="re-text">${rendered('\\int_0^1 f', true)}</p>`)
    restoreMath(p)
    expect(p.textContent).toBe('$$\\int_0^1 f$$')
    expect(p.querySelector('*')).toBeNull()
  })

  it('leaves a dedicated math box as one plain text node', () => {
    const box = el(`<div class="re-el re-math">${rendered('E=mc^2')}</div>`)
    restoreMath(box)
    expect(box.childNodes).toHaveLength(1)
    expect(box.childNodes[0].nodeType).toBe(3)
    expect(box.textContent).toBe('\\(E=mc^2\\)')
  })

  it('saves rich markup around the math untouched', () => {
    const p = el(`<p class="re-el re-text">The <b>famous</b> ${rendered('E=mc^2')}</p>`)
    expect(cleanElementHtml(p)).toBe('<p class="re-el re-text">The <b>famous</b> \\(E=mc^2\\)</p>')
  })
})

describe('editing a text box that contains math', () => {
  beforeEach(() => {
    document.execCommand = () => true
    window.renderMathInElement = fakeRenderMathInElement
    document.body.innerHTML =
      '<div class="reveal"><div class="slides"><section></section></div></div>'
  })

  it('shows the LaTeX source while editing and re-renders on commit', () => {
    const section = document.querySelector('section')
    section.innerHTML = `<p class="re-el re-text">Energy is ${rendered('E=mc^2')} always.</p>`
    const p = section.querySelector('p')

    startTextEdit(p, bridge())
    // plain, typeable text — no KaTeX tree for the caret to fall into
    expect(p.querySelector('.katex')).toBeNull()
    expect(p.textContent).toBe('Energy is \\(E=mc^2\\) always.')

    stopTextEdit()
    expect(p.querySelector('.katex')).not.toBeNull()
    expect(cleanElementHtml(p)).toBe('<p class="re-el re-text">Energy is \\(E=mc^2\\) always.</p>')
  })

  it('renders math the user typed with $ … $, saving it as \\( … \\)', () => {
    const section = document.querySelector('section')
    section.innerHTML = '<p class="re-el re-text">x</p>'
    const p = section.querySelector('p')

    startTextEdit(p, bridge())
    p.textContent = 'Let $a^2 + b^2 = c^2$ hold.'
    stopTextEdit()

    expect(p.querySelector('.katex')).not.toBeNull()
    expect(cleanElementHtml(p)).toBe('<p class="re-el re-text">Let \\(a^2 + b^2 = c^2\\) hold.</p>')
  })

  it('an emptied text box is still removed rather than rendered', () => {
    const section = document.querySelector('section')
    section.innerHTML = '<p class="re-el re-text">gone</p>'
    const p = section.querySelector('p')
    startTextEdit(p, bridge())
    p.textContent = '   '
    stopTextEdit()
    expect(section.querySelector('p')).toBeNull()
  })

  it('wraps the selected text in inline math delimiters', () => {
    const section = document.querySelector('section')
    section.innerHTML = '<p class="re-el re-text">use x here</p>'
    const p = section.querySelector('p')
    startTextEdit(p, bridge())

    // stand in for the browser's insertText, which happy-dom does not run
    const selection = { isCollapsed: false, toString: () => 'x' }
    window.getSelection = () => selection
    let inserted = null
    document.execCommand = (command, _ui, value) => {
      if (command === 'insertText') inserted = value
      return true
    }
    insertInlineMath()
    expect(inserted).toBe('\\(x\\)')

    stopTextEdit()
  })
})
