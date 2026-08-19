// Edit-mode setup inside the deck iframe. We take layout control away from
// reveal (disableLayout) and scale the fixed design canvas ourselves, so the
// editor always knows the exact canvas-px coordinate space. This works for
// any deck, including foreign ones, because it is pure runtime
// configuration — nothing here is ever written to the file.

const EDIT_STYLE_ID = 're-edit-style'

import { editor } from '../../stores/editor.svelte.js'

export function getCanvasSize(bridge) {
  const config = bridge.config()
  return {
    width: Number(editor.settings.width) || config.width || 960,
    height: Number(editor.settings.height) || config.height || 700
  }
}

export function enterEditMode(bridge) {
  bridge.doc.body.classList.add('re-edit-mode')
  bridge.Reveal.configure({
    keyboard: false,
    touch: false,
    controls: false,
    progress: false,
    slideNumber: false,
    autoAnimate: false,
    autoPlayMedia: false,
    fragments: true,
    transition: 'none',
    backgroundTransition: 'none',
    disableLayout: true,
    center: false,
    hash: false
  })

  injectEditStyles(bridge.doc)
  const relayout = () => applyStageScale(bridge)
  relayout()
  bridge.win.addEventListener('resize', relayout)
  watchMediaKey(bridge)
  return { relayout, getScale: () => currentScale(bridge) }
}

// While editing, videos are pointer-inert so they select/move like any
// element. Holding Ctrl hands the pointer back to the native player
// (play, scrub, volume). Listen in both documents — focus can sit in
// either — and clear on blur so the class never sticks.
function watchMediaKey(bridge) {
  const setLive = (on) => bridge.doc.body.classList.toggle('re-media-live', on)
  const onKey = (e) => {
    if (e.key === 'Control') setLive(e.type === 'keydown')
  }
  const clear = () => setLive(false)
  for (const win of [window, bridge.win]) {
    win.addEventListener('keydown', onKey)
    win.addEventListener('keyup', onKey)
    win.addEventListener('blur', clear)
  }
}

function currentScale(bridge) {
  const { width } = getCanvasSize(bridge)
  const rect = bridge.slidesEl.getBoundingClientRect()
  return rect.width / width
}

export function applyStageScale(bridge) {
  const { width, height } = getCanvasSize(bridge)
  const slides = bridge.slidesEl
  const stageW = bridge.win.innerWidth
  const stageH = bridge.win.innerHeight
  // Snap the scaled canvas to whole pixels: a percentage-centered transform
  // can land the layer on a half-pixel boundary, and the compositor's
  // resampling then reads as ghosting/halos on fine glyphs (SVG ring text).
  let scale = Math.min(stageW / (width + 40), stageH / (height + 40))
  scale = Math.max(1, Math.round(width * scale)) / width
  const left = Math.round((stageW - width * scale) / 2)
  const top = Math.round((stageH - height * scale) / 2)

  // Reveal's own layout may have left inline zoom/size styles; we own the
  // canvas now. These inline styles live on .slides itself, which is never
  // part of the saved innerHTML.
  const place = (el) => {
    el.style.width = `${width}px`
    el.style.height = `${height}px`
    el.style.position = 'absolute'
    el.style.left = '0'
    el.style.top = '0'
    el.style.transform = `translate(${left}px, ${top}px) scale(${scale})`
    el.style.transformOrigin = '0 0'
  }
  slides.style.zoom = ''
  place(slides)

  // Pin reveal's background layer (a sibling of .slides) to the same
  // canvas geometry so slide backgrounds don't flood the whole stage.
  const backgrounds = bridge.doc.querySelector('.reveal .backgrounds')
  if (backgrounds) place(backgrounds)
}

function injectEditStyles(doc) {
  if (doc.getElementById(EDIT_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = EDIT_STYLE_ID
  style.textContent = `
    /* reveal-editor edit mode (runtime only, never saved) */
    .reveal .slides section { min-height: 100%; }
    /* all fragments stay visible while editing */
    .reveal .slides section .fragment {
      visibility: visible !important;
      opacity: 1 !important;
    }
    /* faint canvas edge */
    .reveal .slides {
      outline: 1px solid rgba(128, 128, 128, 0.35);
    }
    body.re-show-grid .reveal .slides section.present {
      background-image:
        linear-gradient(rgba(47,111,186,.16) 1px, transparent 1px),
        linear-gradient(90deg, rgba(47,111,186,.16) 1px, transparent 1px);
      background-size: var(--re-grid-size) var(--re-grid-size);
    }
    body.re-show-grid .reveal .slides section.present::before {
      content: ''; position: absolute; pointer-events: none; z-index: 2147483646;
      inset: var(--re-safe-margin); border: 1px dashed rgba(47,111,186,.45);
    }
    /* videos are pointer-inert while editing so they behave like any other
       element; hold Ctrl to use the native player */
    body:not(.re-media-live) .reveal .slides section video { pointer-events: none; }
    body.re-media-live .reveal .slides section video { outline: 2px solid rgba(47,111,186,.65); }
    /* selection frame handles overlap the player's control bar; get them
       fully out of the way while the native player is live */
    body.re-media-live .moveable-control-box { display: none !important; }
    body { overflow: hidden; }
  `
  doc.head.appendChild(style)
}
