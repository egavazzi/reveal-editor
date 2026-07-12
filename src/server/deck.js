// Deck file load/save. The deck HTML file is the single source of truth:
// on save, only the innerHTML of the .slides element is replaced (with
// deterministically formatted markup); every byte outside it — head,
// scripts, comments, custom CSS — is preserved untouched.
import { readFile, writeFile, rename, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { parse } from 'parse5'
import { formatFragment } from './serialize.js'

// mtimes of writes made by us, so the file watcher can ignore them.
export const ownWrites = new Map()

export async function loadDeck(deckPath) {
  const [html, s] = await Promise.all([readFile(deckPath, 'utf8'), stat(deckPath)])
  return { html, mtimeMs: s.mtimeMs }
}

function findSlidesElement(node, insideReveal = false) {
  if (node.attrs) {
    const cls = (node.attrs.find((a) => a.name === 'class')?.value ?? '').split(/\s+/)
    const inReveal = insideReveal || cls.includes('reveal')
    if (cls.includes('slides') && inReveal && node.sourceCodeLocation) return node
    insideReveal = inReveal
  }
  for (const child of node.childNodes ?? []) {
    const found = findSlidesElement(child, insideReveal)
    if (found) return found
  }
  return null
}

/**
 * Locate the .slides element inside .reveal in the original source text.
 * Returns { innerStart, innerEnd, indent } — offsets of the innerHTML byte
 * range and the indentation of the .slides start tag line.
 */
export function locateSlides(html) {
  const doc = parse(html, { sourceCodeLocationInfo: true })
  const el = findSlidesElement(doc)
  if (!el) return null
  const loc = el.sourceCodeLocation
  if (!loc.startTag || !loc.endTag) return null
  const lineStart = html.lastIndexOf('\n', loc.startTag.startOffset) + 1
  const indent = html.slice(lineStart, loc.startTag.startOffset).match(/^[ \t]*/)[0]
  return { innerStart: loc.startTag.endOffset, innerEnd: loc.endTag.startOffset, indent }
}

/**
 * Produce the new deck file text with .slides innerHTML replaced by the
 * formatted version of slidesHtml. Pure function of (originalHtml, slidesHtml).
 */
export function spliceSlides(originalHtml, slidesHtml) {
  const loc = locateSlides(originalHtml)
  if (!loc) throw new Error('could not locate <div class="slides"> in deck file')
  const formatted = formatFragment(slidesHtml, loc.indent + '  ')
  const inner = formatted ? `\n${formatted}\n${loc.indent}` : '\n' + loc.indent
  return originalHtml.slice(0, loc.innerStart) + inner + originalHtml.slice(loc.innerEnd)
}

export async function saveDeck(deckPath, slidesHtml) {
  const original = await readFile(deckPath, 'utf8')
  const next = spliceSlides(original, slidesHtml)
  // Atomic write: temp file in the same directory, then rename over.
  const tmp = `${deckPath}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, next, 'utf8')
  await rename(tmp, deckPath)
  const s = await stat(deckPath)
  ownWrites.set(deckPath, Date.now())
  return { mtimeMs: s.mtimeMs }
}
