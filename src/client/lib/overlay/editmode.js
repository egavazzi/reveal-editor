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
  return { relayout, getScale: () => currentScale(bridge) }
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
  const scale = Math.min(stageW / (width + 40), stageH / (height + 40))

  // Reveal's own layout may have left inline zoom/size styles; we own the
  // canvas now. These inline styles live on .slides itself, which is never
  // part of the saved innerHTML.
  slides.style.zoom = ''
  slides.style.width = `${width}px`
  slides.style.height = `${height}px`
  slides.style.position = 'absolute'
  slides.style.left = '50%'
  slides.style.top = '50%'
  slides.style.transform = `translate(-50%, -50%) scale(${scale})`
  slides.style.transformOrigin = 'center'

  // Pin reveal's background layer (a sibling of .slides) to the same
  // canvas geometry so slide backgrounds don't flood the whole stage.
  const backgrounds = bridge.doc.querySelector('.reveal .backgrounds')
  if (backgrounds) {
    backgrounds.style.width = `${width}px`
    backgrounds.style.height = `${height}px`
    backgrounds.style.position = 'absolute'
    backgrounds.style.left = '50%'
    backgrounds.style.top = '50%'
    backgrounds.style.transform = `translate(-50%, -50%) scale(${scale})`
    backgrounds.style.transformOrigin = 'center'
  }
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
    body { overflow: hidden; }
  `
  doc.head.appendChild(style)
}
