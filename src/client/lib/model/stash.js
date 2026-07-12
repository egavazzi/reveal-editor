// Pristine-stash pass, run ONCE immediately after attaching to the deck,
// before any user edit. Reveal.js and its plugins mutate the slide DOM at
// load (highlight.js rewrites code blocks, reveal assigns
// data-fragment-index to all fragments). To save clean files we must know
// what the author actually wrote. The pristine file HTML is available from
// GET /api/deck; we pair its elements with the live DOM by document order
// (safe at attach time — nothing has been edited yet) and record the
// authored state in transient data attributes that the save cleaner
// consumes and strips.

/** Attribute holding the authored innerHTML of a <code> block. */
export const CODE_SRC_ATTR = 'data-re-code-src'
/** Marker: this fragment had NO authored data-fragment-index. */
export const FRAG_AUTO_ATTR = 'data-re-frag-auto'

export function stashPristineState(liveSlidesEl, pristineHtml) {
  const pristineDoc = new DOMParser().parseFromString(pristineHtml, 'text/html')
  const pristineSlides = pristineDoc.querySelector('.reveal .slides')
  if (!pristineSlides) return

  const liveCode = liveSlidesEl.querySelectorAll('pre > code')
  const pristineCode = pristineSlides.querySelectorAll('pre > code')
  if (liveCode.length === pristineCode.length) {
    liveCode.forEach((el, i) => {
      el.setAttribute(CODE_SRC_ATTR, pristineCode[i].innerHTML)
    })
  }

  const liveFragments = liveSlidesEl.querySelectorAll('.fragment')
  const pristineFragments = pristineSlides.querySelectorAll('.fragment')
  if (liveFragments.length === pristineFragments.length) {
    liveFragments.forEach((el, i) => {
      if (!pristineFragments[i].hasAttribute('data-fragment-index')) {
        el.setAttribute(FRAG_AUTO_ATTR, '')
      }
    })
  }
}
