// Video/media playback properties. Persisted as plain attributes on the
// <video> element: native `controls`/`loop`/`muted`/`playsinline`, plus
// reveal.js's `data-autoplay` (plays when the slide becomes visible).
// Playback settings live on the <video> even when a crop frame wraps it;
// size and decorations belong to the outer element.
import { isImageFrame, readRect, resizeFrameContents, videoOf } from './crop.js'
import { VIDEO_CONTROLS_ATTR } from './videocontrols.js'

// A framed video's controls are the runtime's bar, marked by an attribute of
// our own; a bare one uses the browser's native player.
function controlsAttr(el) {
  return isImageFrame(el) ? VIDEO_CONTROLS_ATTR : 'controls'
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
    autoplay: video.hasAttribute('data-autoplay'),
    loop: video.hasAttribute('loop'),
    muted: video.hasAttribute('muted'),
    controls: video.hasAttribute(controlsAttr(el))
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
  if (values.autoplay != null) video.toggleAttribute('data-autoplay', Boolean(values.autoplay))
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
    video.toggleAttribute(controlsAttr(el), Boolean(values.controls))
  }
  return true
}
