// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { loadSlideTemplates, removeSlideTemplate, storeSlideTemplate } from '../../src/client/lib/model/templates.js'

function storage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

describe('slide templates', () => {
  it('stores, loads, and removes cleaned slide templates', () => {
    const target = storage()
    const item = storeSlideTemplate({ name: 'Results', html: '<section><h2>Results</h2></section>' }, target)
    expect(item.name).toBe('Results')
    expect(loadSlideTemplates(target)).toEqual([item])
    expect(removeSlideTemplate(item.id, target)).toBe(true)
    expect(loadSlideTemplates(target)).toEqual([])
  })

  it('recovers from malformed local storage', () => {
    expect(loadSlideTemplates({ getItem: () => '{bad' })).toEqual([])
  })
})
