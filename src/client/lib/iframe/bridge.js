// Same-origin bridge to the reveal.js deck running inside the iframe.
// The parent window has full contentDocument access; no postMessage needed.

/**
 * Wait for the iframe's deck to load and its Reveal instance to be ready.
 * Returns a bridge object with direct handles into the deck.
 */
export function connectDeck(iframe) {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('deck did not become ready within 15s')), 15000)

    function tryAttach() {
      const win = iframe.contentWindow
      if (!win) return false
      const Reveal = win.Reveal
      if (!Reveal || typeof Reveal.isReady !== 'function') return false
      const finish = () => {
        clearTimeout(timeout)
        resolvePromise(makeBridge(iframe, win))
      }
      if (Reveal.isReady()) finish()
      else Reveal.on('ready', finish)
      return true
    }

    iframe.addEventListener('load', () => {
      // Reveal script runs after DOMContentLoaded; poll briefly until the
      // global exists and reports ready.
      const poll = setInterval(() => {
        if (tryAttach()) clearInterval(poll)
      }, 50)
      setTimeout(() => clearInterval(poll), 15000)
    }, { once: true })
  })
}

function makeBridge(iframe, win) {
  const Reveal = win.Reveal
  const doc = win.document

  return {
    iframe,
    win,
    doc,
    Reveal,
    get slidesEl() {
      return doc.querySelector('.reveal .slides')
    },
    get currentSection() {
      return Reveal.getCurrentSlide()
    },
    getSections() {
      return [...doc.querySelectorAll('.reveal .slides > section')]
    },
    getIndex() {
      return Reveal.getIndices()
    },
    goTo(h, v = 0) {
      Reveal.slide(h, v)
    },
    next() {
      Reveal.next()
    },
    prev() {
      Reveal.prev()
    },
    sync() {
      Reveal.sync()
      Reveal.layout()
    },
    /** Current scale applied by reveal to the .slides canvas. */
    getScale() {
      return Reveal.getScale()
    },
    config() {
      return Reveal.getConfig()
    }
  }
}
