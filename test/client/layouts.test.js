// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { applyLayout, isSlideEmpty, slideLayoutsFor, SLIDE_LAYOUTS } from '../../src/client/lib/model/layouts.js'
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

  it('offers UiT compositions only while the uit theme is active', () => {
    expect(slideLayoutsFor({ theme: 'uit' }).some((item) => item.id === 'uit-title')).toBe(true)
    expect(slideLayoutsFor({ theme: 'white' })).toEqual(SLIDE_LAYOUTS)
    expect(slideLayoutsFor()).toEqual(SLIDE_LAYOUTS)

    document.body.innerHTML = '<div class="slides"><section class="re-slide"></section></div>'
    const section = document.querySelector('section')
    // without the uit theme the layout id is rejected
    expect(applyLayout(section, 'uit-title', { width: 960, height: 700 })).toHaveLength(0)
  })

  it('builds the UiT chapter divider like the template: ice field, panel, footer band', () => {
    document.body.innerHTML = '<div class="slides"><section class="re-slide"></section></div>'
    const section = document.querySelector('section')
    const elements = applyLayout(section, 'uit-chapter', { width: 960, height: 700, theme: 'uit' })

    expect(section.getAttribute('data-background-color')).toBe('#CDEBEF')
    expect(section.classList.contains('uit-own-footer')).toBe(true)
    expect(elements[0].tagName.toLowerCase()).toBe('svg')
    expect(elements[0].getAttribute('preserveAspectRatio')).toBe('none')
    // white footer band with the full wordmark
    expect(section.querySelector('div[aria-label="Footer band"]')).not.toBeNull()
    expect(section.querySelector('svg[aria-label="UiT wordmark"] path')).not.toBeNull()
  })

  it('builds UiT title/chapter image frames behind a locked field polygon', () => {
    document.body.innerHTML = '<div class="slides"><section class="re-slide"></section></div>'
    const slides = document.querySelector('.slides')
    const section = document.querySelector('section')
    applyLayout(section, 'uit-title', { width: 960, height: 700, theme: 'uit' })

    const field = section.querySelector('svg[aria-label="Background field"]')
    expect(field).not.toBeNull()
    expect(field.hasAttribute('data-re-locked')).toBe(true)
    const placeholder = section.querySelector('.re-image-placeholder')
    expect(placeholder.getAttribute('data-re-fit')).toBe('cover')
    // the placeholder (and hence a dropped image) stacks directly behind the
    // field, so the field crops the image along the template diagonal
    expect(placeholder.nextElementSibling).toBe(field)
    // editor-only hint never reaches the saved file
    expect(cleanSlides(slides)).not.toContain('re-image-placeholder')
  })

  it('offers the five solid content backgrounds from the template', () => {
    const cases = [
      ['uit-content-white', '#FFFFFF'], ['uit-content-ice', '#CDEBEF'],
      ['uit-content-yellow', '#FCEECC'], ['uit-content-red', '#F7E0E2'],
      ['uit-content-dark', '#003349']
    ]
    for (const [id, bg] of cases) {
      document.body.innerHTML = '<div class="slides"><section class="re-slide"></section></div>'
      const section = document.querySelector('section')
      applyLayout(section, id, { width: 960, height: 700, theme: 'uit' })
      expect(section.getAttribute('data-background-color')).toBe(bg)
      // content slides keep the theme's corner emblem
      expect(section.classList.contains('uit-own-footer')).toBe(false)
    }
  })

  it('scales UiT layout geometry to a non-default canvas', () => {
    document.body.innerHTML = '<div class="slides"><section class="re-slide"></section></div>'
    const section = document.querySelector('section')
    const elements = applyLayout(section, 'uit-title', { width: 1920, height: 1400, theme: 'uit' })

    // panel starts at 57.6% of the width, as in the template layout XML
    const panel = elements[0]
    expect(panel.style.left).toBe('1106px')
    expect(section.querySelector('h1').style.left).toBe('119px')
  })

  it('embeds the emblem in the UiT closing slide', () => {
    document.body.innerHTML = '<div class="slides"><section class="re-slide"></section></div>'
    const section = document.querySelector('section')
    applyLayout(section, 'uit-closing', { width: 960, height: 700, theme: 'uit' })

    expect(section.getAttribute('data-background-color')).toBe('#003349')
    expect(section.querySelector('svg[aria-label="UiT emblem"] path')).not.toBeNull()
  })

  it('marks the emblem of the Björn closing slide for the theme animation', () => {
    document.body.innerHTML = '<div class="slides"><section class="re-slide"></section></div>'
    const section = document.querySelector('section')
    applyLayout(section, 'uit-closing-bjorn', { width: 960, height: 700, theme: 'uit' })

    expect(section.getAttribute('data-background-color')).toBe('#003349')
    const emblem = section.querySelector('svg[aria-label="UiT emblem"]')
    expect(emblem.classList.contains('uit-emblem-zoom-spin')).toBe(true)
    expect(section.querySelector('svg.uit-emblem-zoom-spin path')).not.toBeNull()
  })

  it('treats speaker notes and transient guidance as empty slide metadata', () => {
    document.body.innerHTML = '<section><aside class="notes">private</aside><div class="re-transient">hint</div></section>'
    expect(isSlideEmpty(document.querySelector('section'))).toBe(true)
  })
})

