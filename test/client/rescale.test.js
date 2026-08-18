// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { rescaleSlides } from '../../src/client/lib/model/rescale.js'

function makeSlides(html) {
  document.body.innerHTML = `<div class="slides">${html}</div>`
  return document.querySelector('.slides')
}

describe('rescaleSlides', () => {
  it('scales positions, sizes and font sizes by the axis ratios', () => {
    const slidesEl = makeSlides(`
      <section>
        <h1 class="re-el" style="position:absolute; left:100px; top:70px; width:480px; height:140px; font-size:30px;">Hi</h1>
      </section>`)

    expect(rescaleSlides(slidesEl, { width: 960, height: 700 }, { width: 1920, height: 1400 })).toBe(true)

    const el = slidesEl.querySelector('h1')
    expect(el.style.left).toBe('200px')
    expect(el.style.top).toBe('140px')
    expect(el.style.width).toBe('960px')
    expect(el.style.height).toBe('280px')
    expect(el.style.fontSize).toBe('60px')
  })

  it('scales axes independently for non-uniform resizes', () => {
    const slidesEl = makeSlides(`
      <section>
        <div class="re-el" style="position:absolute; left:96px; top:70px; width:480px; height:350px; font-size:28px;">x</div>
      </section>`)

    rescaleSlides(slidesEl, { width: 960, height: 700 }, { width: 1280, height: 720 })

    const el = slidesEl.querySelector('div')
    expect(el.style.left).toBe('128px') // × 4/3
    expect(el.style.top).toBe('72px') // × 720/700
    expect(el.style.width).toBe('640px')
    expect(el.style.height).toBe('360px')
    expect(el.style.fontSize).toBe('29px') // fonts follow the height ratio
  })

  it('reaches vertical stacks and group children, and skips notes', () => {
    const slidesEl = makeSlides(`
      <section>
        <section>
          <div class="re-el re-group" style="position:absolute; left:10px; top:10px; width:200px; height:100px;">
            <p style="position:absolute; left:20px; top:10px; width:100px; font-size:20px;">child</p>
          </div>
          <aside class="notes"><p style="position:absolute; left:50px;">note</p></aside>
        </section>
      </section>`)

    rescaleSlides(slidesEl, { width: 960, height: 700 }, { width: 1920, height: 1400 })

    const group = slidesEl.querySelector('.re-group')
    const child = group.querySelector('p')
    expect(group.style.left).toBe('20px')
    expect(child.style.left).toBe('40px')
    expect(child.style.fontSize).toBe('40px')
    expect(slidesEl.querySelector('aside.notes p').style.left).toBe('50px')
  })

  it('rewrites svg shape geometry to the scaled size', () => {
    const slidesEl = makeSlides(`
      <section>
        <svg class="re-el" data-shape="rect" style="position:absolute; left:50px; top:50px; width:240px; height:160px;"><rect stroke-width="3"/></svg>
      </section>`)

    rescaleSlides(slidesEl, { width: 960, height: 700 }, { width: 1920, height: 1400 })

    const svg = slidesEl.querySelector('svg')
    expect(svg.style.width).toBe('480px')
    expect(svg.getAttribute('viewBox')).toBe('0 0 480 320')
  })

  it('does nothing for a no-op or invalid resize', () => {
    const slidesEl = makeSlides(`
      <section><div class="re-el" style="position:absolute; left:10px; top:10px;">x</div></section>`)

    expect(rescaleSlides(slidesEl, { width: 960, height: 700 }, { width: 960, height: 700 })).toBe(false)
    expect(rescaleSlides(slidesEl, { width: 0, height: 700 }, { width: 960, height: 700 })).toBe(false)
    expect(slidesEl.querySelector('div').style.left).toBe('10px')
  })

  it('leaves non-pixel and non-positioned styles alone', () => {
    const slidesEl = makeSlides(`
      <section>
        <div class="re-el" style="position:absolute; left:10%; top:10px; width:50%;">percent</div>
        <p style="font-size:20px;">static flow text</p>
      </section>`)

    rescaleSlides(slidesEl, { width: 960, height: 700 }, { width: 1920, height: 1400 })

    const positioned = slidesEl.querySelector('div')
    expect(positioned.style.left).toBe('10%')
    expect(positioned.style.top).toBe('20px')
    expect(positioned.style.width).toBe('50%')
    expect(slidesEl.querySelector('p').style.fontSize).toBe('20px')
  })
})
