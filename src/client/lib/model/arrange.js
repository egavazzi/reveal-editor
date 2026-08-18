// Whole-deck slide rearrangement for the arrange view: the deck becomes a
// matrix of leaf slides (columns = horizontal position, rows = vertical
// stacks). Wrapper <section> stacks are reused where possible so authored
// attributes on them survive, created when a new stack appears, and dropped
// when a stack empties.
import { scrubRuntimeState } from './slides.js'

/**
 * Apply a slide matrix. `matrix` is an array of columns; each column is an
 * array of leaf <section> elements. Returns false (and changes nothing) if
 * the matrix does not cover exactly the deck's current leaf slides.
 */
export function arrangeSlides(bridge, matrix) {
  const slidesEl = bridge.slidesEl
  const columns = matrix.map((column) => column.filter(Boolean)).filter((column) => column.length)
  const leaves = columns.flat()
  const current = bridge.getSlideEntries().map((entry) => entry.section)
  if (leaves.length !== current.length || new Set(leaves).size !== leaves.length) return false
  if (!leaves.every((section) => current.includes(section))) return false

  // Remember original stacks before detaching, so multi-slide columns can
  // keep their wrapper (and its attributes) when composition allows it.
  const originalStack = new Map()
  for (const leaf of leaves) {
    const parent = leaf.parentElement
    if (parent && parent !== slidesEl && parent.tagName === 'SECTION') originalStack.set(leaf, parent)
    leaf.remove()
    scrubRuntimeState(leaf)
  }

  const usedStacks = new Set()
  const newTop = columns.map((column) => {
    if (column.length === 1) return column[0]
    let stack = originalStack.get(column[0])
    if (!stack || usedStacks.has(stack)) stack = bridge.doc.createElement('section')
    usedStacks.add(stack)
    scrubRuntimeState(stack)
    stack.append(...column)
    return stack
  })

  // Every leaf was re-homed above; remaining top-level sections are emptied
  // wrapper stacks.
  for (const section of slidesEl.querySelectorAll(':scope > section')) section.remove()
  slidesEl.append(...newTop)
  bridge.sync()
  return true
}
