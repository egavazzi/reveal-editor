// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { editor } from '../../src/client/stores/editor.svelte.js'
import { openPresentation } from '../../src/client/lib/actions.js'

describe('opening the presentation', () => {
  it('starts on the current slide, addressed by reveal’s location hash', () => {
    const opened = []
    window.open = (url) => opened.push(url)
    editor.deckFile = 'talk.html'

    editor.slideIndex = { h: 3, v: 0 }
    openPresentation({ fromCurrent: true })
    editor.slideIndex = { h: 3, v: 2 }
    openPresentation({ fromCurrent: true })
    openPresentation()
    openPresentation({ pdf: true })

    expect(opened).toEqual([
      '/deck/talk.html#/3',
      '/deck/talk.html#/3/2',
      '/deck/talk.html',
      '/deck/talk.html?print-pdf'
    ])
  })
})
