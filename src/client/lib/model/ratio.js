// Aspect-ratio locking for resize. Pictures and videos are locked by
// default — stretching them is almost always a mistake — while boxes and
// shapes resize freely. A cropped image is a frame around its picture, so
// it counts as a picture here: resizing it scales the picture with the
// frame, which would distort it just the same. The attribute only records
// a departure from that default, so untouched decks stay free of editor
// bookkeeping:
//
//   (absent)                      -> the element's default
//   data-re-lock-ratio            -> locked
//   data-re-lock-ratio="off"      -> unlocked
const ATTR = 'data-re-lock-ratio'
const LOCKED_BY_DEFAULT = 'img, video, .re-image-frame'

export function lockedByDefault(el) {
  return Boolean(el?.matches?.(LOCKED_BY_DEFAULT))
}

export function isRatioLocked(el) {
  if (!el) return false
  const value = el.getAttribute?.(ATTR)
  if (value == null) return lockedByDefault(el)
  return value !== 'off'
}

export function setRatioLocked(el, locked) {
  if (!el) return
  if (Boolean(locked) === lockedByDefault(el)) el.removeAttribute(ATTR)
  else el.setAttribute(ATTR, locked ? '' : 'off')
}
