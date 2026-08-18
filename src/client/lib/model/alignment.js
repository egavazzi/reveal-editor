function dimensions(el) {
  const rect = el.getBoundingClientRect?.() || {}
  return {
    el,
    x: parseFloat(el.style.left) || 0,
    y: parseFloat(el.style.top) || 0,
    width: parseFloat(el.style.width) || rect.width || el.offsetWidth || 0,
    height: parseFloat(el.style.height) || rect.height || el.offsetHeight || 0
  }
}

/** Align or evenly distribute absolutely positioned elements in canvas px. */
export function arrangeElements(elements, mode) {
  const items = elements.filter(Boolean).map(dimensions)
  if (items.length < 2) return false
  const left = Math.min(...items.map((item) => item.x))
  const top = Math.min(...items.map((item) => item.y))
  const right = Math.max(...items.map((item) => item.x + item.width))
  const bottom = Math.max(...items.map((item) => item.y + item.height))

  for (const item of items) {
    if (mode === 'left') item.x = left
    else if (mode === 'center') item.x = left + (right - left - item.width) / 2
    else if (mode === 'right') item.x = right - item.width
    else if (mode === 'top') item.y = top
    else if (mode === 'middle') item.y = top + (bottom - top - item.height) / 2
    else if (mode === 'bottom') item.y = bottom - item.height
  }

  if (mode === 'distribute-horizontal' && items.length >= 3) {
    const ordered = [...items].sort((a, b) => a.x - b.x)
    const totalWidth = ordered.reduce((sum, item) => sum + item.width, 0)
    const gap = (right - left - totalWidth) / (ordered.length - 1)
    let cursor = left
    for (const item of ordered) {
      item.x = cursor
      cursor += item.width + gap
    }
  } else if (mode === 'distribute-vertical' && items.length >= 3) {
    const ordered = [...items].sort((a, b) => a.y - b.y)
    const totalHeight = ordered.reduce((sum, item) => sum + item.height, 0)
    const gap = (bottom - top - totalHeight) / (ordered.length - 1)
    let cursor = top
    for (const item of ordered) {
      item.y = cursor
      cursor += item.height + gap
    }
  } else if (mode.startsWith('distribute-')) {
    return false
  } else if (!['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(mode)) {
    return false
  }

  for (const item of items) {
    item.el.style.left = `${Math.round(item.x)}px`
    item.el.style.top = `${Math.round(item.y)}px`
  }
  return true
}

