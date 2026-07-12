import { describe, expect, it } from 'vitest'
import { formatFragment } from '../../src/server/serialize.js'

describe('formatFragment', () => {
  it('is idempotent', () => {
    const inputs = [
      '<section><h2>Hi</h2><p>text with <em>inline</em> stuff</p></section>',
      '<section>\n\t\t<ul>\n<li>a</li><li>b</li></ul></section>',
      '<section><pre><code class="language-julia">x = 1\n  y = 2</code></pre></section>',
      '<section><p>Math: \\(E = mc^2\\)</p><!-- a comment --></section>'
    ]
    for (const input of inputs) {
      const once = formatFragment(input)
      expect(formatFragment(once)).toBe(once)
    }
  })

  it('never splits inline content onto separate lines', () => {
    const out = formatFragment('<p><em>a</em> <strong>b</strong></p>')
    expect(out).toBe('<p><em>a</em> <strong>b</strong></p>')
    // adjacent spans must not gain whitespace
    const spans = formatFragment('<div><span>a</span><span>b</span></div>')
    expect(spans).toBe('<div><span>a</span><span>b</span></div>')
  })

  it('pretty-prints block-only children', () => {
    const out = formatFragment('<section><ul><li>a</li><li>b</li></ul></section>')
    expect(out).toBe(
      '<section>\n  <ul>\n    <li>a</li>\n    <li>b</li>\n  </ul>\n</section>'
    )
  })

  it('preserves pre content verbatim', () => {
    const src = '<pre><code class="language-julia">function f(x)\n    x .^ 2\nend</code></pre>'
    expect(formatFragment(src)).toBe(src)
  })

  it('orders attributes canonically: id, class … style last', () => {
    const out = formatFragment('<section><div style="top: 1px; left: 2px" data-x="1" class="c" id="i">t</div></section>')
    expect(out).toContain('<div id="i" class="c" data-x="1" style="left: 2px; top: 1px">t</div>')
  })

  it('normalizes style declaration order deterministically', () => {
    const out = formatFragment('<div class="re-el" style="height: 10px;width: 20px;  top: 5px;left: 1px;color: red">x</div>')
    expect(out).toBe('<div class="re-el" style="left: 1px; top: 5px; width: 20px; height: 10px; color: red">x</div>')
  })

  it('preserves semicolons in CSS values and case-sensitive custom properties', () => {
    const out = formatFragment(
      `<div style="--BrandColor: red; color: var(--BrandColor); background-image: url('data:image/svg+xml;utf8,a;b')">x</div>`
    )
    expect(out).toContain('--BrandColor: red')
    expect(out).toContain('color: var(--BrandColor)')
    expect(out).toContain("background-image: url('data:image/svg+xml;utf8,a;b')")
  })

  it('gives positioned elements their own lines (svg/img canvas elements)', () => {
    const out = formatFragment(
      '<section><h2>t</h2><svg data-shape="rect" style="position: absolute; left: 1px"><rect></rect></svg>' +
      '<img src="x.png" style="position: absolute; left: 2px"></section>'
    )
    expect(out.split('\n').length).toBe(5)
    expect(out).toContain('\n  <svg')
    expect(out).toContain('\n  <img')
    expect(formatFragment(out)).toBe(out)
  })

  it('keeps non-positioned inline svg in verbatim mode', () => {
    const src = '<p>flow <svg><rect></rect></svg> art</p>'
    expect(formatFragment(src)).toBe(src)
  })

  it('preserves comments', () => {
    const out = formatFragment('<section><!-- intro --><h2>t</h2></section>')
    expect(out).toContain('<!-- intro -->')
    expect(formatFragment(out)).toBe(out)
  })

  it('preserves settings JSON stored inside template content', () => {
    const src = '<template data-re-settings>{"slideNumbers":true,"slideNumberFormat":"c/t"}</template>' +
      '<section><h2>Title</h2></section>'
    const out = formatFragment(src)
    expect(out).toContain('<template data-re-settings>{"slideNumbers":true,"slideNumberFormat":"c/t"}</template>')
    expect(formatFragment(out)).toBe(out)
  })

  it('indents with the given base indent', () => {
    const out = formatFragment('<section><h2>t</h2></section>', '      ')
    expect(out).toBe('      <section>\n        <h2>t</h2>\n      </section>')
  })
})
