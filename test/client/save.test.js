import { beforeEach, describe, expect, it, vi } from 'vitest'

const putDeck = vi.fn()

vi.mock('../../src/client/lib/api.js', () => ({ putDeck }))

const { editor, runtime } = await import('../../src/client/stores/editor.svelte.js')
const { saveDeck } = await import('../../src/client/lib/model/save.js')

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  putDeck.mockReset()
  const slidesEl = document.createElement('div')
  slidesEl.innerHTML = '<section><p>before</p></section>'
  runtime.bridge = { slidesEl }
  editor.mtimeMs = 1
  editor.docVersion = 1
  editor.dirty = true
  editor.saving = false
  editor.statusMessage = ''
})

describe('saveDeck', () => {
  it('queues a follow-up save when the document changes during a request', async () => {
    const first = deferred()
    const second = deferred()
    putDeck.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const initialSave = saveDeck()
    runtime.bridge.slidesEl.querySelector('p').textContent = 'after'
    editor.docVersion++
    editor.dirty = true
    first.resolve({ mtimeMs: 2 })
    await initialSave

    expect(editor.dirty).toBe(true)
    expect(putDeck).toHaveBeenCalledTimes(2)
    expect(putDeck.mock.calls[1][0]).toContain('after')

    second.resolve({ mtimeMs: 3 })
    await vi.waitFor(() => expect(editor.saving).toBe(false))
    expect(editor.dirty).toBe(false)
    expect(editor.mtimeMs).toBe(3)
  })
})
