import { cp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Create a new self-contained deck folder:
 *   <dir>/deck.html   — from templates/deck
 *   <dir>/assets/     — empty asset dir
 *   <dir>/reveal/     — vendored reveal.js + katex dist (pinned in this repo)
 * Returns the path to the created deck.html.
 */
export async function scaffoldDeck(dir) {
  const target = resolve(dir)
  const deckPath = join(target, 'deck.html')
  if (existsSync(deckPath)) {
    throw new Error(`${deckPath} already exists`)
  }
  const revealDist = join(repoRoot, 'templates', 'reveal-dist')
  if (!existsSync(revealDist)) {
    throw new Error('templates/reveal-dist missing — run: npm run vendor')
  }
  await mkdir(join(target, 'assets'), { recursive: true })
  await cp(join(repoRoot, 'templates', 'deck', 'deck.html'), deckPath)
  await cp(revealDist, join(target, 'reveal'), { recursive: true })
  return deckPath
}
