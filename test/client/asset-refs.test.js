// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  assetReferences, hasReferenceTo, normalizeAssetPath, referencedAssetPaths,
  rewriteAssetReferences, samePath
} from '../../src/client/lib/model/asset-refs.js'

function root(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  return div
}

describe('normalizeAssetPath', () => {
  it('drops query, fragment, ./ and the /deck/ mount', () => {
    expect(normalizeAssetPath('assets/a.png?v=2')).toBe('assets/a.png')
    expect(normalizeAssetPath('./assets/a.png#x')).toBe('assets/a.png')
    expect(normalizeAssetPath('/deck/assets/a.png')).toBe('assets/a.png')
    expect(normalizeAssetPath('assets/my%20pic.png')).toBe('assets/my pic.png')
  })

  it('ignores references that are not deck files', () => {
    expect(normalizeAssetPath('https://example.com/a.png')).toBe('')
    expect(normalizeAssetPath('data:image/png;base64,AAA')).toBe('')
    expect(normalizeAssetPath('blob:abc')).toBe('')
    expect(normalizeAssetPath('')).toBe('')
    expect(normalizeAssetPath(null)).toBe('')
  })

  it('matches paths written in different but equivalent forms', () => {
    expect(samePath('./assets/a.png', 'assets/a.png?v=1')).toBe(true)
    expect(samePath('assets/a.png', 'assets/b.png')).toBe(false)
    expect(samePath('', '')).toBe(false)
  })
})

describe('assetReferences', () => {
  const html = `
    <img src="assets/a.png">
    <img data-src="assets/b.png">
    <video poster="assets/p.jpg" data-src="assets/v.webm"><source src="assets/v.mp4"></video>
    <section data-background-image="assets/bg.png"></section>
    <section data-background-video="assets/one.mp4,assets/two.webm"></section>
    <div style="background-image: url('assets/css.png'); color: red"></div>
    <img src="https://example.com/remote.png">
    <div data-re-frame="assets/a.png"></div>`

  it('finds every attribute kind that can name a file', () => {
    const refs = assetReferences(root(html))
    expect(refs.map((r) => `${r.attribute}:${r.path}`)).toEqual([
      'src:assets/a.png',
      'data-src:assets/b.png',
      'data-src:assets/v.webm',
      'poster:assets/p.jpg',
      'src:assets/v.mp4',
      'data-background-image:assets/bg.png',
      'data-background-video:assets/one.mp4',
      'data-background-video:assets/two.webm',
      'style:assets/css.png'
    ])
  })

  it('lists the distinct files and answers whether one is used', () => {
    const el = root(html)
    expect(referencedAssetPaths(el)).toHaveLength(9)
    expect(hasReferenceTo(el, 'assets/two.webm')).toBe(true)
    expect(hasReferenceTo(el, './assets/css.png')).toBe(true)
    expect(hasReferenceTo(el, 'assets/gone.png')).toBe(false)
  })

  it('reads a reference on the root element itself', () => {
    const el = root('')
    el.setAttribute('data-background-image', 'assets/bg.png')
    expect(referencedAssetPaths(el)).toEqual(['assets/bg.png'])
  })
})

describe('rewriteAssetReferences', () => {
  it('moves every form of reference onto the new path', () => {
    const el = root(`
      <img src="assets/a.png">
      <img data-src="./assets/a.png">
      <video poster="assets/a.png"><source src="assets/a.png?v=3"></video>
      <section data-background-image="assets/a.png"></section>
      <section data-background-video="assets/a.png, assets/other.webm"></section>
      <div style="background-image: url('assets/a.png'); color: red"></div>`)
    expect(rewriteAssetReferences(el, 'assets/a.png', 'assets/a-1234abcd.webp')).toBe(7)
    expect(hasReferenceTo(el, 'assets/a.png')).toBe(false)
    expect(el.querySelector('[data-background-video]').getAttribute('data-background-video'))
      .toBe('assets/a-1234abcd.webp,assets/other.webm')
    expect(el.querySelector('div[style]').getAttribute('style'))
      .toBe("background-image: url('assets/a-1234abcd.webp'); color: red")
    expect(el.querySelectorAll('[src="assets/a-1234abcd.webp"]')).toHaveLength(2)
  })

  it('leaves decoration attributes and other files alone', () => {
    const el = root('<div data-re-frame="assets/a.png" data-crop="assets/a.png"><img src="assets/b.png"></div>')
    expect(rewriteAssetReferences(el, 'assets/a.png', 'assets/new.png')).toBe(0)
    expect(el.querySelector('div').getAttribute('data-re-frame')).toBe('assets/a.png')
    expect(el.querySelector('img').getAttribute('src')).toBe('assets/b.png')
  })
})
