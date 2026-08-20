// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { enterEditMode } from '../../src/client/lib/overlay/editmode.js'

function fakeBridge(doc) {
  return {
    doc,
    win: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    slidesEl: doc.querySelector('.reveal .slides'),
    Reveal: { configure() {} },
    config: () => ({ width: 960, height: 700 })
  }
}

describe('edit mode', () => {
  // Following a link replaces the document the editor is attached to, and
  // the deck iframe has no browser chrome to come back with.
  it('never lets a link navigate the editor away from the deck', () => {
    document.body.innerHTML =
      '<div class="reveal"><div class="slides"><section class="present">' +
      '<p class="re-el">see <a href="https://example.com/paper">the paper</a></p>' +
      '<img class="re-el" src="figure.png">' +
      '</section></div></div>'
    enterEditMode(fakeBridge(document))

    const onLink = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.querySelector('a').dispatchEvent(onLink)
    expect(onLink.defaultPrevented).toBe(true)

    // clicks elsewhere keep their default behavior — the overlay's own
    // selection handling rides on them
    const onImage = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.querySelector('img').dispatchEvent(onImage)
    expect(onImage.defaultPrevented).toBe(false)
  })
})
