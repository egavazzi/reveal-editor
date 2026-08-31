// Video/media playback properties. Persisted as plain attributes on the
// <video> element: native `loop`/`muted`/`playsinline`, reveal.js's
// `data-autoplay` (plays when the slide becomes visible) or the editor's
// `data-re-autoplay-delay` in its place, and `data-re-controls` for the
// control bar the deck runtime draws (see videocontrols.js). Playback
// settings live on the <video> even when a crop frame wraps it; size and
// decorations belong to the outer element.
import { isImageFrame, readRect, resizeFrameContents, videoOf } from './crop.js'
import { VIDEO_CONTROLS_ATTR, VIDEO_DELAY_ATTR } from './videocontrols.js'

/** Autoplay is on whichever way it is written: at once, or after a delay. */
function autoplayDelayOf(video) {
  return Math.max(0, parseFloat(video.getAttribute(VIDEO_DELAY_ATTR)) || 0)
}

export function videoInfo(el) {
  const video = videoOf(el)
  if (!video) return null
  return {
    // the outer element (a crop frame, or the video itself) and the picture
    el,
    media: video,
    cropped: isImageFrame(el),
    width: Math.round(parseFloat(el.style.width) || el.getBoundingClientRect().width),
    height: Math.round(parseFloat(el.style.height) || el.getBoundingClientRect().height),
    // decode failure (codec/container the browser can't play)
    broken: Boolean(video.error),
    autoplay: video.hasAttribute('data-autoplay') || video.hasAttribute(VIDEO_DELAY_ATTR),
    autoplayDelay: autoplayDelayOf(video),
    loop: video.hasAttribute('loop'),
    muted: video.hasAttribute('muted'),
    controls: video.hasAttribute(VIDEO_CONTROLS_ATTR)
  }
}

export function applyVideoProperties(el, values) {
  const video = videoOf(el)
  if (!video) return false
  if (values.width != null || values.height != null) {
    const start = { frame: readRect(el), media: readRect(video) }
    if (values.width != null) el.style.width = `${Math.max(1, Number(values.width))}px`
    if (values.height != null) el.style.height = `${Math.max(1, Number(values.height))}px`
    // a frame always carries both inline dimensions (wrapImage sets them)
    if (isImageFrame(el)) {
      resizeFrameContents(el, start, parseFloat(el.style.width), parseFloat(el.style.height))
    }
  }
  if (values.autoplay != null || values.autoplayDelay != null) {
    const autoplay = values.autoplay != null
      ? Boolean(values.autoplay)
      : video.hasAttribute('data-autoplay') || video.hasAttribute(VIDEO_DELAY_ATTR)
    const delay = values.autoplayDelay != null
      ? Math.max(0, Number(values.autoplayDelay) || 0)
      : autoplayDelayOf(video)
    // the two attributes are exclusive: reveal starts a data-autoplay video
    // the moment the slide opens, which is not what a delay asks for
    video.toggleAttribute('data-autoplay', autoplay && delay === 0)
    if (autoplay && delay > 0) video.setAttribute(VIDEO_DELAY_ATTR, String(delay))
    else video.removeAttribute(VIDEO_DELAY_ATTR)
  }
  if (values.loop != null) {
    video.toggleAttribute('loop', Boolean(values.loop))
    video.loop = Boolean(values.loop)
  }
  if (values.muted != null) {
    // the content attribute persists the default; the property affects the
    // live preview immediately
    video.toggleAttribute('muted', Boolean(values.muted))
    video.muted = Boolean(values.muted)
  }
  if (values.controls != null) {
    video.toggleAttribute(VIDEO_CONTROLS_ATTR, Boolean(values.controls))
    // the browser's own player is never what a deck of ours shows
    video.removeAttribute('controls')
  }
  return true
}
