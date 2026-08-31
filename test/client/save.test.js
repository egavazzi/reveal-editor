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
  it('does not rewrite an untouched deck', async () => {
    editor.dirty = false
    await saveDeck()
    expect(putDeck).not.toHaveBeenCalled()
    expect(editor.statusMessage).toBe('No changes to save.')
  })

  it('queues a follow-up save when the document changes during a request', async () => {
    const first = deferred()
    const second = deferred()
    putDeck.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const initialSave = saveDeck()
    runtime.bridge.slidesEl.querySelector('p').textContent = 'after'
    editor.docVersion++
    editor.dirty = true
    first.resolve({ mtimeMs: 2 })
    await vi.waitFor(() => expect(putDeck).toHaveBeenCalledTimes(2))

    // the follow-up save is still in flight
    expect(editor.dirty).toBe(true)
    expect(putDeck.mock.calls[1][0]).toContain('after')

    second.resolve({ mtimeMs: 3 })
    // the initial call resolves only once the follow-up has landed
    await initialSave
    expect(editor.saving).toBe(false)
    expect(editor.dirty).toBe(false)
    expect(editor.mtimeMs).toBe(3)
  })

  it('a call during an in-flight save resolves once the deck is clean', async () => {
    const first = deferred()
    const second = deferred()
    putDeck.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    void saveDeck()
    runtime.bridge.slidesEl.querySelector('p').textContent = 'after'
    editor.docVersion++
    editor.dirty = true
    const concurrent = saveDeck() // e.g. Present clicked while autosave runs

    first.resolve({ mtimeMs: 2 })
    await vi.waitFor(() => expect(putDeck).toHaveBeenCalledTimes(2))
    second.resolve({ mtimeMs: 3 })
    await concurrent

    expect(editor.dirty).toBe(false)
    expect(editor.mtimeMs).toBe(3)
  })

  it('offers to overwrite when the deck changed on disk (409)', async () => {
    putDeck
      .mockRejectedValueOnce(Object.assign(new Error('deck changed on disk'), { status: 409 }))
      .mockResolvedValueOnce({ mtimeMs: 9 })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    await saveDeck()

    expect(putDeck).toHaveBeenCalledTimes(2)
    // the forced save carries no mtime precondition
    expect(putDeck.mock.calls[1][1]).toBe(null)
    expect(editor.dirty).toBe(false)
    expect(editor.mtimeMs).toBe(9)
    expect(editor.statusMessage).toContain('overwrote disk version')
    confirm.mockRestore()
  })

  it('keeps edits unsaved when the user declines to overwrite', async () => {
    putDeck.mockRejectedValueOnce(Object.assign(new Error('deck changed on disk'), { status: 409 }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    await saveDeck()

    expect(putDeck).toHaveBeenCalledTimes(1)
    expect(editor.dirty).toBe(true)
    expect(editor.statusMessage).toContain('Not saved')
    confirm.mockRestore()
  })
})
