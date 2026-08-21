// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { editor, runtime } from '../../src/client/stores/editor.svelte.js'
import {
  bringToFront, sendToBack, currentLayers, groupSelection, ungroupSelection,
  moveLayer, selectLayer, selectLayers, toggleLayerSelection
} from '../../src/client/lib/actions.js'
import { DEFAULT_SETTINGS } from '../../src/client/lib/model/settings.js'

function box(id, left, top) {
  return `<div class="re-el" id="${id}" style="position:absolute;left:${left}px;top:${top}px;width:100px;height:50px">${id}</div>`
}

function ids(container) {
  return [...container.children].map((el) => el.id || el.className)
}

let selection = []

function makeBridge() {
  const slidesEl = document.querySelector('.slides')
  return {
    slidesEl,
    doc: document,
    win: {},
    Reveal: { configure() {}, getPlugin() { return null } },
    config: () => ({ width: 960, height: 700, margin: 0.04 }),
    getSections: () => [...slidesEl.children].filter((el) => el.tagName === 'SECTION'),
    get currentSection() { return slidesEl.querySelector('section') },
    getIndex: () => ({ h: 0, v: 0 }),
    sync() {},
    goTo() {}
  }
}

describe('layers and groups', () => {
  let section

  beforeEach(() => {
    document.body.innerHTML =
      `<div class="reveal"><div class="slides"><section>${box('a', 0, 0)}${box('b', 40, 40)}${box('c', 80, 80)}<aside class="notes">n</aside></section></div></div>`
    section = document.querySelector('section')
    runtime.bridge = makeBridge()
    runtime.editMode = null
    selection = []
    runtime.overlay = {
      getSelection: () => selection,
      setSelection(els) { selection = els },
      reconfigure() {},
      refresh() {}
    }
    editor.slideIndex = { h: 0, v: 0 }
    editor.settings = { ...DEFAULT_SETTINGS }
    editor.autosave = false
    editor.statusMessage = ''
  })

  const el = (id) => document.getElementById(id)

  it('keeps the stacking order of grouped elements, whatever order they were picked in', () => {
    selection = [el('c'), el('a'), el('b')]
    expect(groupSelection()).toBe(true)
    const group = section.querySelector('.re-group')
    expect(ids(group)).toEqual(['a', 'b', 'c'])
    // members stop being editable units, without an empty class="" left in
    // the saved deck
    expect(el('a').hasAttribute('class')).toBe(false)
    expect(el('a').hasAttribute('data-re-group-child')).toBe(true)
  })

  it('puts the group where its frontmost member was', () => {
    // group the two BACK elements while `c` stays in front of them
    selection = [el('a'), el('b')]
    expect(groupSelection()).toBe(true)
    expect(ids(section)).toEqual(['re-el re-group', 'c', 'notes'])
  })

  it('restores ungrouped elements at the group position, in order', () => {
    selection = [el('a'), el('c')]
    groupSelection()
    expect(ungroupSelection()).toBe(true)
    expect(ids(section)).toEqual(['b', 'a', 'c', 'notes'])
    expect(el('a').style.left).toBe('0px')
    expect(el('c').style.top).toBe('80px')
    expect(el('a').classList.contains('re-el')).toBe(true)
    expect(el('a').hasAttribute('data-re-group-child')).toBe(false)
  })

  it('refuses to group across levels and says why', () => {
    selection = [el('a'), el('b')]
    groupSelection()
    selection = [el('a'), el('c')]
    expect(groupSelection()).toBe(false)
    expect(editor.statusMessage).toMatch(/same level/)
  })

  it('nests a group inside a group as a group child', () => {
    selection = [el('a'), el('b'), el('c')]
    groupSelection()
    const outer = section.querySelector('.re-group')
    selection = [el('a'), el('b')]
    expect(groupSelection()).toBe(true)
    const inner = outer.querySelector('.re-group')
    expect(inner.hasAttribute('data-re-group-child')).toBe(true)
    expect(inner.getAttribute('class')).toBe('re-group')
    expect(ids(outer)).toEqual(['re-group', 'c'])
  })

  it('lists group members as children of the group layer, frontmost first', () => {
    selection = [el('a'), el('b')]
    groupSelection()
    const layers = currentLayers()
    expect(layers.map((l) => l.kind)).toEqual(['text', 'group'])
    expect(layers[1].children.map((l) => l.el.id)).toEqual(['b', 'a'])
    expect(layers[1].children.map((l) => l.depth)).toEqual([1, 1])
    expect(layers[1].children[0].isFront).toBe(true)
    expect(layers[1].children[1].isBack).toBe(true)
  })

  it('moves a layer inside its group without leaving it', () => {
    selection = [el('a'), el('b'), el('c')]
    groupSelection()
    const group = section.querySelector('.re-group')
    expect(moveLayer(el('a'), 'up')).toBe(true)
    expect(ids(group)).toEqual(['b', 'a', 'c'])
    expect(moveLayer(el('a'), 'down')).toBe(true)
    expect(ids(group)).toEqual(['a', 'b', 'c'])
    // already at the back of the group: nothing to move past
    expect(moveLayer(el('a'), 'down')).toBe(false)
    expect(ids(section)).toEqual(['re-el re-group', 'notes'])
  })

  it('brings a group member to the front of its group only', () => {
    selection = [el('a'), el('b')]
    groupSelection()
    const group = section.querySelector('.re-group')
    selection = [el('a')]
    bringToFront()
    expect(ids(group)).toEqual(['b', 'a'])
    expect(el('a').parentElement).toBe(group)
    sendToBack()
    expect(ids(group)).toEqual(['a', 'b'])
  })

  it('keeps relative order when several elements move to the front together', () => {
    selection = [el('b'), el('a')]
    bringToFront()
    expect(ids(section)).toEqual(['c', 'a', 'b', 'notes'])
  })

  it('never selects a group together with one of its own members', () => {
    selection = [el('a'), el('b')]
    groupSelection()
    const group = section.querySelector('.re-group')
    selectLayers([group, el('a')])
    expect(selection).toEqual([group])
    selection = [group]
    toggleLayerSelection(el('a'))
    expect(selection).toEqual([el('a')])
  })

  it('adds and removes layers from the selection, skipping locked ones', () => {
    selectLayer(el('a'))
    toggleLayerSelection(el('b'))
    expect(selection.map((e) => e.id)).toEqual(['a', 'b'])
    toggleLayerSelection(el('b'))
    expect(selection.map((e) => e.id)).toEqual(['a'])
    el('c').setAttribute('data-re-locked', '')
    toggleLayerSelection(el('c'))
    expect(selection.map((e) => e.id)).toEqual(['a'])
  })
})
