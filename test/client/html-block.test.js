// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { insertHtmlBlock } from '../../src/client/lib/model/insert.js'
import { cleanSlides } from '../../src/client/lib/model/clean.js'

describe('custom HTML blocks', () => {
  it('saves authored HTML and scripts without editor artifacts in the content', () => {
    document.body.innerHTML = '<div class="slides"><section></section></div>'
    const section = document.querySelector('section')
    const bridge = {
      doc: document,
      currentSection: section,
      config: () => ({ width: 960, height: 700 })
    }
    const el = insertHtmlBlock(bridge)
    el.innerHTML = '<button data-action="demo">Run</button><script>window.demo = true</script>'

    const saved = cleanSlides(document.querySelector('.slides'))
    expect(saved).toContain('<button data-action="demo">Run</button>')
    expect(saved).toContain('<script>window.demo = true</script>')
    expect(saved).not.toContain('contenteditable')
  })
})
