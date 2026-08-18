// Video/media playback properties. Persisted as plain attributes on the
// <video> element: native `controls`/`loop`/`muted`/`playsinline`, plus
// reveal.js's `data-autoplay` (plays when the slide becomes visible).

export function videoInfo(el) {
  if (!el || el.tagName !== 'VIDEO') return null
  return {
    el,
    width: Math.round(parseFloat(el.style.width) || el.getBoundingClientRect().width),
    height: Math.round(parseFloat(el.style.height) || el.getBoundingClientRect().height),
    // decode failure (codec/container the browser can't play)
    broken: Boolean(el.error),
    autoplay: el.hasAttribute('data-autoplay'),
    loop: el.hasAttribute('loop'),
    muted: el.hasAttribute('muted'),
    controls: el.hasAttribute('controls')
  }
}

export function applyVideoProperties(el, values) {
  if (!el || el.tagName !== 'VIDEO') return false
  if (values.width != null) el.style.width = `${Math.max(1, Number(values.width))}px`
  if (values.height != null) el.style.height = `${Math.max(1, Number(values.height))}px`
  if (values.autoplay != null) el.toggleAttribute('data-autoplay', Boolean(values.autoplay))
  if (values.loop != null) {
    el.toggleAttribute('loop', Boolean(values.loop))
    el.loop = Boolean(values.loop)
  }
  if (values.muted != null) {
    // the content attribute persists the default; the property affects the
    // live preview immediately
    el.toggleAttribute('muted', Boolean(values.muted))
    el.muted = Boolean(values.muted)
  }
  if (values.controls != null) {
    el.toggleAttribute('controls', Boolean(values.controls))
  }
  return true
}
