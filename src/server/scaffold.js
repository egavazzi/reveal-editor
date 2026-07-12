import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
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

/**
 * Make a one-way, independently editable copy of rendered Quarto reveal HTML.
 * Local src/href assets are copied with their relative paths. The QMD source is
 * deliberately not interpreted and future Quarto renders do not update this copy.
 */
export async function ejectQuartoHtml(inputFile, dir) {
  const source = resolve(inputFile)
  const sourceDir = dirname(source)
  const target = resolve(dir)
  const deckPath = join(target, 'deck.html')
  if (!existsSync(source)) throw new Error(`No such rendered HTML file: ${source}`)
  if (existsSync(deckPath)) throw new Error(`${deckPath} already exists`)
  const html = await readFile(source, 'utf8')
  if (!/class=["'][^"']*reveal/.test(html) || !/class=["'][^"']*slides/.test(html)) {
    throw new Error('Input does not look like a rendered reveal.js presentation')
  }
  await mkdir(target, { recursive: true })
  await cp(source, deckPath)

  const refs = new Set([...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1]))
  const copiedRoots = new Set()
  for (const ref of refs) {
    const clean = ref.split(/[?#]/)[0]
    if (!clean || /^(?:[a-z]+:|\/|#)/i.test(clean)) continue
    const from = resolve(sourceDir, clean)
    if (relative(sourceDir, from).startsWith('..') || !existsSync(from)) continue
    const rootName = clean.split('/')[0]
    const assetRoot = resolve(sourceDir, rootName)
    if (clean.includes('/') && existsSync(assetRoot) && !copiedRoots.has(rootName)) {
      await cp(assetRoot, resolve(target, rootName), { recursive: true })
      copiedRoots.add(rootName)
      continue
    }
    const to = resolve(target, clean)
    await mkdir(dirname(to), { recursive: true })
    await cp(from, to, { recursive: true })
  }

  await writeFile(join(target, 'EJECTED_FROM_QUARTO.md'), `# Ejected Quarto presentation

This folder is an independent HTML copy created from:

\`${source}\`

Edits to the original QMD and future \`quarto render\` runs do not update this
deck. Make subsequent presentation edits in \`deck.html\` with reveal-editor.
`, 'utf8')
  return deckPath
}
