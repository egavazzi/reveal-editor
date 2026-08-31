// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import { openPresentation } from '../../src/client/lib/actions.js'
import * as api from '../../src/client/lib/api.js'

describe('opening the presentation', () => {
  it('starts on the current slide, addressed by reveal’s location hash', () => {
    const opened = []
    window.open = (url) => opened.push(url)
    editor.deckFile = 'talk.html'
    editor.dirty = false

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

  it('writes unsaved edits out before showing the deck from disk', async () => {
    document.body.innerHTML = '<div class="reveal"><div class="slides"><section><p>hi</p></section></div></div>'
    const put = vi.spyOn(api, 'putDeck').mockResolvedValue({ mtimeMs: 2 })
    const tab = { location: null, close: vi.fn() }
    window.open = () => tab
    runtime.bridge = { slidesEl: document.querySelector('.slides') }
    editor.deckFile = 'talk.html'
    editor.dirty = true

    await openPresentation()

    expect(put).toHaveBeenCalled()
    expect(editor.dirty).toBe(false)
    expect(tab.location).toBe('/deck/talk.html')
    expect(tab.close).not.toHaveBeenCalled()
    put.mockRestore()
  })
})
