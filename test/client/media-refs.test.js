import { describe, expect, it } from 'vitest'
import { formatSrcset, parseSrcset, splitFragment } from '../../src/client/lib/media-refs.js'

describe('srcset parsing', () => {
  const cases = [
    ['', []],
    ['a.png', [{ url: 'a.png', descriptor: '' }]],
    ['a.png 1x, b.png 2x', [{ url: 'a.png', descriptor: '1x' }, { url: 'b.png', descriptor: '2x' }]],
    // No whitespace after the comma is legal and common in minified markup.
    ['a.png 1x,b.png 2x', [{ url: 'a.png', descriptor: '1x' }, { url: 'b.png', descriptor: '2x' }]],
    ['a.png, b.png', [{ url: 'a.png', descriptor: '' }, { url: 'b.png', descriptor: '' }]],
    // A URL runs to the next whitespace, so an unseparated comma is part of it.
    ['a.png,b.png', [{ url: 'a.png,b.png', descriptor: '' }]],
    ['  a.png   1x ,  b.png   640w  ', [{ url: 'a.png', descriptor: '1x' }, { url: 'b.png', descriptor: '640w' }]],
    ['a.png\n1x,\nb.png 2x', [{ url: 'a.png', descriptor: '1x' }, { url: 'b.png', descriptor: '2x' }]],
    // Commas inside a data: URL belong to the URL, not to the candidate list.
    ['data:image/png;base64,AAA 1x, b.png 2x',
      [{ url: 'data:image/png;base64,AAA', descriptor: '1x' }, { url: 'b.png', descriptor: '2x' }]],
    ['data:image/png;base64,AAA, b.png',
      [{ url: 'data:image/png;base64,AAA', descriptor: '' }, { url: 'b.png', descriptor: '' }]],
    ['a.png (min-width: 40em), b.png',
      [{ url: 'a.png', descriptor: '(min-width: 40em)' }, { url: 'b.png', descriptor: '' }]],
    ['a.png?x=1,2 2x', [{ url: 'a.png?x=1,2', descriptor: '2x' }]]
  ]

  for (const [input, expected] of cases) {
    it(`parses ${JSON.stringify(input)}`, () => {
      expect(parseSrcset(input)).toEqual(expected)
    })
  }

  it('round-trips through formatSrcset', () => {
    expect(formatSrcset(parseSrcset('a.png 1x,b.png 2x'))).toBe('a.png 1x, b.png 2x')
    expect(formatSrcset(parseSrcset('a.png, b.png'))).toBe('a.png, b.png')
  })
})

describe('fragment splitting', () => {
  it('separates a fragment from the resource', () => {
    expect(splitFragment('sprite.svg#icon')).toEqual({ resource: 'sprite.svg', fragment: '#icon' })
    expect(splitFragment('plot.png')).toEqual({ resource: 'plot.png', fragment: '' })
    expect(splitFragment('#local')).toEqual({ resource: '', fragment: '#local' })
  })
})
