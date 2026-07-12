import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { locateSlides, spliceSlides } from '../../src/server/deck.js'

const here = dirname(fileURLToPath(import.meta.url))
const foreign = readFileSync(join(here, 'fixtures', 'foreign.html'), 'utf8')
const template = readFileSync(
  join(here, '..', '..', 'templates', 'deck', 'deck.html'),
  'utf8'
)

function innerSlides(html) {
  const loc = locateSlides(html)
  return html.slice(loc.innerStart, loc.innerEnd)
}

describe('spliceSlides', () => {
  it('preserves every byte outside .slides', () => {
    const result = spliceSlides(foreign, innerSlides(foreign))
    const loc = locateSlides(foreign)
    const locResult = locateSlides(result)
    expect(result.slice(0, locResult.innerStart)).toBe(foreign.slice(0, loc.innerStart))
    expect(result.slice(locResult.innerEnd)).toBe(foreign.slice(loc.innerEnd))
  })

  it('is idempotent: second no-op save changes nothing', () => {
    const once = spliceSlides(foreign, innerSlides(foreign))
    const twice = spliceSlides(once, innerSlides(once))
    expect(twice).toBe(once)
  })

  it('no-op save of the scaffold template is byte-identical', () => {
    expect(spliceSlides(template, innerSlides(template))).toBe(template)
  })

  it('keeps foreign slide content intact (fragments, code, math, comments)', () => {
    const once = spliceSlides(foreign, innerSlides(foreign))
    expect(once).toContain('data-fragment-index="5"')
    expect(once).toContain('function f(x)\n    return x .^ 2   # broadcast\nend')
    expect(once).toContain('\\(E = mc^2\\)')
    expect(once).toContain('$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$')
    expect(once).toContain('<!-- intro -->')
    expect(once).toContain('data-background-color="#001122"')
    expect(once).toContain('window.talkStats = { views: 0 };')
  })

  it('throws when no .slides exists', () => {
    expect(() => spliceSlides('<html><body><p>nope</p></body></html>', '<section></section>'))
      .toThrow(/could not locate/)
  })
})
