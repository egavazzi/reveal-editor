// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { applyLayout, isSlideEmpty } from '../../src/client/lib/model/layouts.js'
import { cleanSlides } from '../../src/client/lib/model/clean.js'

describe('slide layouts', () => {
  it('creates readable editor-native elements scaled to the canvas', () => {
    document.body.innerHTML = '<div class="slides"><section class="re-slide"></section></div>'
    const section = document.querySelector('section')
    const elements = applyLayout(section, 'two-column', { width: 1920, height: 1080 })

    expect(elements).toHaveLength(3)
    expect(elements[0].tagName).toBe('H2')
    expect(elements[0].style.left).toBe('128px')
    expect(elements[1].textContent).toBe('Left column')
    expect(elements[2].style.width).toBe('768px')
    expect(isSlideEmpty(section)).toBe(false)
  })

  it('uses an editor-only image placeholder that never leaks into a save', () => {
    document.body.innerHTML = '<div class="slides"><section class="re-slide"></section></div>'
    const slides = document.querySelector('.slides')
    const section = document.querySelector('section')
    applyLayout(section, 'image-focus')

    expect(section.querySelector('.re-image-placeholder')).not.toBeNull()
    expect(cleanSlides(slides)).not.toContain('re-image-placeholder')
  })

  it('treats speaker notes and transient guidance as empty slide metadata', () => {
    document.body.innerHTML = '<section><aside class="notes">private</aside><div class="re-transient">hint</div></section>'
    expect(isSlideEmpty(document.querySelector('section'))).toBe(true)
  })
})

