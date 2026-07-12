// Rehydration: after clean HTML is put back into the live DOM (undo/redo,
// clipboard paste), redo what the deck's plugins did at load — highlight
// code, render math — and re-establish the editor's transient bookkeeping
// (code source stash, fragment authorship markers).
import { CODE_SRC_ATTR, FRAG_AUTO_ATTR } from './stash.js'
import { renderMath } from '../editors/mathcode.js'

export function rehydrate(bridge, root) {
  for (const code of root.querySelectorAll('pre > code')) {
    // Only take over blocks without bookkeeping. A block that already has
    // the stash attr is live-highlighted — re-stashing it would overwrite
    // the clean source with highlighted markup.
    if (code.hasAttribute(CODE_SRC_ATTR)) continue
    code.setAttribute(CODE_SRC_ATTR, code.innerHTML)
    code.removeAttribute('data-highlighted')
    const lang = [...code.classList].some((c) => c.startsWith('language-'))
    const hljs = bridge.Reveal.getPlugin?.('highlight')?.hljs
    if (hljs && lang) hljs.highlightElement(code)
  }
  const fragments = [...root.querySelectorAll('.fragment')]
  if (root.matches?.('.fragment')) fragments.push(root)
  for (const frag of fragments) {
    if (!frag.hasAttribute('data-fragment-index')) frag.setAttribute(FRAG_AUTO_ATTR, '')
  }
  renderMath(bridge, root)
}
