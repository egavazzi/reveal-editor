// Slide-level structure operations on the live .slides DOM.
// All of them call Reveal.sync() so reveal's internal state follows.

const RUNTIME_CLASSES = ['past', 'present', 'future', 'stack', 'overflowing']

function scrubRuntimeState(section) {
  section.classList.remove(...RUNTIME_CLASSES)
  if (!section.classList.length) section.removeAttribute('class')
  section.removeAttribute('hidden')
  section.removeAttribute('aria-hidden')
  section.removeAttribute('data-fragment')
  section.style.removeProperty('display')
  section.style.removeProperty('top')
  if (!section.getAttribute('style')?.trim()) section.removeAttribute('style')
}

export function addSlide(bridge, afterIndex) {
  const sections = bridge.getSections()
  const section = bridge.doc.createElement('section')
  section.className = 're-slide'
  const anchor = sections[afterIndex]
  anchor.after(section)
  bridge.sync()
  bridge.goTo(afterIndex + 1)
  return section
}

export function duplicateSlide(bridge, index) {
  const sections = bridge.getSections()
  const clone = sections[index].cloneNode(true)
  scrubRuntimeState(clone)
  // A duplicate is new content. Strip ids at every depth so document
  // queries and authored links never become ambiguous.
  clone.removeAttribute('id')
  for (const identified of clone.querySelectorAll('[id]')) identified.removeAttribute('id')
  sections[index].after(clone)
  bridge.sync()
  bridge.goTo(index + 1)
  return clone
}

export function deleteSlide(bridge, index) {
  const sections = bridge.getSections()
  if (sections.length <= 1) return false
  sections[index].remove()
  bridge.sync()
  bridge.goTo(Math.min(index, sections.length - 2))
  return true
}

export function setSlideBackground(bridge, index, { color, image } = {}) {
  const section = bridge.getSections()[index]
  if (!section) return
  if (color !== undefined) {
    if (color) section.setAttribute('data-background-color', color)
    else section.removeAttribute('data-background-color')
  }
  if (image !== undefined) {
    if (image) section.setAttribute('data-background-image', image)
    else section.removeAttribute('data-background-image')
  }
  bridge.sync()
}

/**
 * Schematic snapshot of every top-level slide for the sidebar: the first
 * heading/text and each visible element's canvas-relative box.
 */
export function slideSummaries(bridge, canvas) {
  return bridge.getSections().map((section, index) => {
    const title =
      section.querySelector('h1, h2, h3, p, li')?.textContent.trim().slice(0, 60) ?? ''
    const background = section.getAttribute('data-background-color') ?? null
    const boxes = [...section.children]
      .filter((el) => el.tagName !== 'SECTION')
      .slice(0, 40)
      .map((el) => {
        const left = parseFloat(el.style.left)
        const top = parseFloat(el.style.top)
        if (Number.isNaN(left) || Number.isNaN(top)) return null
        const width = parseFloat(el.style.width) || el.offsetWidth || 100
        const height = parseFloat(el.style.height) || el.offsetHeight || 40
        return {
          x: (left / canvas.width) * 100,
          y: (top / canvas.height) * 100,
          w: Math.min(100, (width / canvas.width) * 100),
          h: Math.min(100, (height / canvas.height) * 100),
          kind:
            ['img', 'video'].includes(el.tagName.toLowerCase())
              ? 'img'
              : el.tagName.toLowerCase() === 'svg'
                ? 'shape'
                : 'text'
        }
      })
      .filter(Boolean)
    return { id: `s${index}`, index, title, background, boxes }
  })
}
