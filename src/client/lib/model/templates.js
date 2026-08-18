const STORAGE_KEY = 'reveal-editor:slide-templates'

export function loadSlideTemplates(storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value.filter((item) => item?.id && item?.name && item?.html) : []
  } catch {
    return []
  }
}

export function storeSlideTemplate({ name, html }, storage = localStorage) {
  const templates = loadSlideTemplates(storage)
  const item = { id: crypto.randomUUID(), name: String(name).trim(), html }
  if (!item.name || !html) return null
  templates.push(item)
  storage.setItem(STORAGE_KEY, JSON.stringify(templates))
  return item
}

export function removeSlideTemplate(id, storage = localStorage) {
  const templates = loadSlideTemplates(storage)
  const next = templates.filter((item) => item.id !== id)
  storage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next.length !== templates.length
}

