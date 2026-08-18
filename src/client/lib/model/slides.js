// Slide-level structure operations on the live .slides DOM.
// All of them call Reveal.sync() so reveal's internal state follows.

const RUNTIME_CLASSES = ['past', 'present', 'future', 'stack', 'overflowing']

export function scrubRuntimeState(section) {
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

export function addVerticalSlide(bridge, h, v = 0) {
  const horizontals = bridge.getSections()
  let stack = horizontals[h]
  let vertical = [...stack.children].filter((el) => el.tagName === 'SECTION')
  if (!vertical.length) {
    const current = stack
    stack = bridge.doc.createElement('section')
    current.replaceWith(stack)
    scrubRuntimeState(current)
    stack.appendChild(current)
    vertical = [current]
  }
  const section = bridge.doc.createElement('section')
  section.className = 're-slide'
  vertical[Math.min(v, vertical.length - 1)].after(section)
  bridge.sync()
  bridge.goTo(h, Math.min(v + 1, vertical.length))
  return section
}

export function duplicateCurrentSlide(bridge, h, v = 0) {
  const current = bridge.getSlide(h, v)
  const clone = current.cloneNode(true)
  scrubRuntimeState(clone)
  // A duplicate is new content. Strip ids at every depth so document
  // queries and authored links never become ambiguous.
  clone.removeAttribute('id')
  for (const identified of clone.querySelectorAll('[id]')) identified.removeAttribute('id')
  current.after(clone)
  bridge.sync()
  bridge.goTo(h, current.parentElement.matches('.slides') ? 0 : v + 1)
  return clone
}

export function deleteCurrentSlide(bridge, h, v = 0) {
  const current = bridge.getSlide(h, v)
  const parent = current?.parentElement
  if (!current || !parent) return false
  if (parent.matches('.slides')) return deleteSlide(bridge, h)
  const siblings = [...parent.children].filter((el) => el.tagName === 'SECTION')
  if (siblings.length <= 1) return false
  current.remove()
  if (siblings.length === 2) {
    const survivor = siblings.find((section) => section !== current)
    scrubRuntimeState(survivor)
    parent.replaceWith(survivor)
    bridge.sync()
    bridge.goTo(h, 0)
  } else {
    bridge.sync()
    bridge.goTo(h, Math.min(v, siblings.length - 2))
  }
  return true
}

export function moveCurrentSlide(bridge, h, v, direction) {
  const current = bridge.getSlide(h, v)
  const parent = current?.parentElement
  if (!current || !parent) return false
  const sibling = direction < 0 ? current.previousElementSibling : current.nextElementSibling
  if (!sibling || sibling.tagName !== 'SECTION') return false
  if (direction < 0) sibling.before(current)
  else sibling.after(current)
  bridge.sync()
  if (parent.matches('.slides')) bridge.goTo(h + direction, 0)
  else bridge.goTo(h, v + direction)
  return true
}

export function promoteVerticalSlide(bridge, h, v) {
  const current = bridge.getSlide(h, v)
  const stack = current?.parentElement
  if (!current || !stack || stack.matches('.slides')) return false
  const siblings = [...stack.children].filter((el) => el.tagName === 'SECTION')
  current.remove()
  scrubRuntimeState(current)
  if (siblings.length === 2) {
    const survivor = siblings.find((section) => section !== current)
    scrubRuntimeState(survivor)
    stack.replaceWith(survivor)
    survivor.after(current)
  } else {
    stack.after(current)
  }
  bridge.sync()
  bridge.goTo(h + 1, 0)
  return true
}

export function demoteHorizontalSlide(bridge, h) {
  if (h <= 0) return false
  const horizontals = bridge.getSections()
  const current = horizontals[h]
  let target = horizontals[h - 1]
  if (!current || !target) return false
  const vertical = [...target.children].filter((el) => el.tagName === 'SECTION')
  current.remove()
  scrubRuntimeState(current)
  let nextV
  if (vertical.length) {
    target.appendChild(current)
    nextV = vertical.length
  } else {
    const first = target
    target = bridge.doc.createElement('section')
    first.replaceWith(target)
    scrubRuntimeState(first)
    target.append(first, current)
    nextV = 1
  }
  bridge.sync()
  bridge.goTo(h - 1, nextV)
  return true
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

export function setSlideBackground(bridge, h, v = 0, { color, image } = {}) {
  const section = bridge.getSlide?.(h, v) ?? bridge.getSections()[h]
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
 * Miniature snapshot of every slide for the sidebar and arrange view: each
 * visible element's canvas-relative box plus enough visual detail (text with
 * its themed size/color, image sources, shape markup) to render a
 * recognizable thumbnail without embedding the deck.
 */
export function slideSummaries(bridge, canvas) {
  const entries = bridge.getSlideEntries?.() ?? bridge.getSections().map((section, h) => ({ section, h, v: 0, vertical: false }))
  const win = bridge.doc?.defaultView
  // themed page background so thumbnails match dark themes
  let deckBackground = win ? win.getComputedStyle(bridge.doc.body).backgroundColor : ''
  if (deckBackground === 'rgba(0, 0, 0, 0)' || deckBackground === 'transparent') deckBackground = ''
  // thumbnails render in the editor chrome, whose base URL differs from the
  // deck's — resolve asset urls against the deck document
  const resolveUrl = (url, el) => {
    if (!url) return null
    try {
      return new URL(url, el.baseURI).href
    } catch {
      return url
    }
  }
  return entries.map(({ section, h, v, vertical }, index) => {
    const title =
      section.querySelector('h1, h2, h3, p, li')?.textContent.trim().slice(0, 60) ?? ''
    const background = section.getAttribute('data-background-color') ?? null
    const backgroundImage = resolveUrl(section.getAttribute('data-background-image'), section)
    const boxes = []
    const collect = (el, offsetX, offsetY) => {
      if (boxes.length >= 40) return
      const left = parseFloat(el.style.left)
      const top = parseFloat(el.style.top)
      if (Number.isNaN(left) || Number.isNaN(top)) return
      const width = parseFloat(el.style.width) || el.offsetWidth || 100
      const height = parseFloat(el.style.height) || el.offsetHeight || 40
      const tag = el.tagName.toLowerCase()
      if (el.classList.contains('re-group')) {
        // render a group by its children, offset into the group's frame
        for (const child of el.children) collect(child, offsetX + left, offsetY + top)
        return
      }
      const box = {
        x: ((offsetX + left) / canvas.width) * 100,
        y: ((offsetY + top) / canvas.height) * 100,
        w: Math.min(100, (width / canvas.width) * 100),
        h: Math.min(100, (height / canvas.height) * 100),
        kind: tag === 'img' ? 'img'
          : tag === 'video' ? 'video'
            : tag === 'svg' ? 'shape'
              : tag === 'pre' || el.querySelector?.('pre > code') ? 'code' : 'text'
      }
      if (box.kind === 'img') {
        box.src = resolveUrl(el.getAttribute('src'), el)
      } else if (box.kind === 'shape') {
        box.svg = el.outerHTML
      } else {
        box.text = el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 160) || ''
        const computed = win ? win.getComputedStyle(el) : null
        const fontSize = computed ? parseFloat(computed.fontSize) : 0
        // width-relative units so the text scales with the thumbnail
        box.fontSize = ((fontSize || 30) / canvas.width) * 100
        if (computed) {
          box.color = computed.color
          box.align = computed.textAlign
          box.bold = Number(computed.fontWeight) >= 600 || /^h[1-6]$/.test(tag)
        }
      }
      boxes.push(box)
    }
    for (const el of [...section.children]) {
      if (el.tagName === 'SECTION' || el.matches('aside.notes, .re-transient') ||
          el.hasAttribute('data-re-hidden')) continue
      collect(el, 0, 0)
    }
    return { id: `s${h}-${v}`, index, h, v, vertical, title, background, backgroundImage, deckBackground, boxes }
  })
}
