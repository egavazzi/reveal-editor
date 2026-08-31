// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { editor } from '../../src/client/stores/editor.svelte.js'

vi.mock('../../src/client/lib/api.js', () => ({
  uploadAsset: async (blob, name) => ({ path: `assets/${name}` })
}))

const { insertImageBlob } = await import('../../src/client/lib/model/insert.js')

// An Image that "decodes" only PNGs (200×100) and fails on anything else,
// asynchronously like the real thing.
class FakeImage {
  set src(value) {
    queueMicrotask(() => {
      if (value.endsWith('.png')) {
        this.naturalWidth = 200
        this.naturalHeight = 100
        this.onload?.()
      } else {
        this.onerror?.()
      }
    })
  }
}

function makeBridge() {
  document.body.innerHTML = '<div class="slides"><section id="a"></section><section id="b"></section></div>'
  const bridge = {
    doc: document,
    win: { Image: FakeImage },
    current: document.getElementById('a'),
    get currentSection() { return this.current },
    config: () => ({ width: 960, height: 700 })
  }
  return bridge
}

beforeEach(() => {
  editor.settings.width = 960
  editor.settings.height = 700
})

describe('insertImageBlob placement', () => {
  it('centres a displayable image on the drop point', async () => {
    const bridge = makeBridge()
    const el = await insertImageBlob(bridge, new Blob(), 'pic.png', { at: { x: 240, y: 210 } })
    expect(el.parentElement.id).toBe('a')
    expect(el.style.width).toBe('200px')
    expect(el.style.height).toBe('100px')
    expect(el.style.left).toBe('140px')
    expect(el.style.top).toBe('160px')
  })

  it('keeps a drop near the edge inside the canvas', async () => {
    const bridge = makeBridge()
    const el = await insertImageBlob(bridge, new Blob(), 'pic.png', { at: { x: 5, y: 695 } })
    expect(el.style.left).toBe('0px')
    expect(el.style.top).toBe('600px')
  })

  it('lands on the slide it was dropped on even if the user moves on during conversion', async () => {
    const bridge = makeBridge()
    const sections = []
    const convert = async (path, name, { onProgress }) => {
      expect(path).toBe('assets/pic.tiff')
      expect(name).toBe('pic.tiff')
      expect(typeof onProgress).toBe('function')
      // the placeholder box stands on the original slide at the drop point
      const box = document.querySelector('#a .re-converting')
      expect(box).not.toBe(null)
      expect(box.style.left).toBe('300px') // 500 − 400/2
      expect(box.style.top).toBe('150px') // 300 − 300/2
      bridge.current = document.getElementById('b')
      return 'assets/pic.png'
    }
    const el = await insertImageBlob(bridge, new Blob(), 'pic.tiff', {
      at: { x: 500, y: 300 }, convert, beforeInsert: (s) => sections.push(s.id)
    })
    expect(el.parentElement.id).toBe('a')
    expect(sections).toEqual(['a'])
    expect(document.querySelector('.re-converting')).toBe(null)
    // centred where the box was
    expect(el.style.left).toBe('400px')
    expect(el.style.top).toBe('250px')
  })

  it('fails when the target slide was deleted during conversion', async () => {
    const bridge = makeBridge()
    const convert = async () => {
      document.getElementById('a').remove()
      return 'assets/pic.png'
    }
    await expect(insertImageBlob(bridge, new Blob(), 'pic.tiff', { convert }))
      .rejects.toThrow('no longer exists')
    expect(document.querySelector('.re-converting')).toBe(null)
  })

  it('reports an undecodable file when nothing can convert it', async () => {
    const bridge = makeBridge()
    await expect(insertImageBlob(bridge, new Blob(), 'pic.tiff'))
      .rejects.toThrow("this browser can't display pic.tiff")
  })
})
