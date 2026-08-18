#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from '../src/server/index.js'
import { ejectQuartoHtml, scaffoldDeck } from '../src/server/scaffold.js'

const HELP = `reveal-editor — WYSIWYG editor for reveal.js presentations

Usage:
  reveal-editor <deck.html> [options]   Edit an existing deck
  reveal-editor new <dir> [options]     Create a new deck folder, then edit it
  reveal-editor eject <html> <dir>      Copy rendered Quarto HTML into an independent deck

Options:
  --port <n>    Port to listen on (default: 3737)
  --no-open     Don't open the browser automatically
  --dev         Run the editor UI from source via Vite (for development)
  --help        Show this help
`

function parseArgs(argv) {
  const args = { _: [], port: 3737, open: true, dev: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--port') args.port = Number(argv[++i])
    else if (a === '--no-open') args.open = false
    else if (a === '--dev') args.dev = true
    else args._.push(a)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (args.help || args._.length === 0) {
  console.log(HELP)
  process.exit(args.help ? 0 : 1)
}

let deckPath
if (args._[0] === 'new') {
  const dir = args._[1]
  if (!dir) {
    console.error('Usage: reveal-editor new <dir>')
    process.exit(1)
  }
  deckPath = await scaffoldDeck(resolve(dir))
  console.log(`Created new deck at ${deckPath}`)
} else if (args._[0] === 'eject') {
  const input = args._[1]
  const dir = args._[2]
  if (!input || !dir) {
    console.error('Usage: reveal-editor eject <rendered.html> <dir>')
    process.exit(1)
  }
  deckPath = await ejectQuartoHtml(resolve(input), resolve(dir))
  console.warn('Ejected one-way from Quarto: future QMD renders will not update this deck.')
  console.log(`Created independent deck at ${deckPath}`)
} else {
  deckPath = resolve(args._[0])
  if (!existsSync(deckPath)) {
    console.error(`No such file: ${deckPath}`)
    process.exit(1)
  }
  if (statSync(deckPath).isDirectory()) {
    const candidate = resolve(deckPath, 'deck.html')
    if (existsSync(candidate)) deckPath = candidate
    else {
      console.error(`${deckPath} is a directory without a deck.html`)
      process.exit(1)
    }
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let url
try {
  ;({ url } = await createServer({ deckPath, port: args.port, dev: args.dev, repoRoot }))
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${args.port} is already in use — is another reveal-editor (or dev server) running?\n` +
      `Close it, or pick another port:  reveal-editor <deck> --port ${args.port + 1}`
    )
  } else {
    console.error(`Could not start reveal-editor: ${err.message}`)
  }
  process.exit(1)
}
console.log(`reveal-editor: editing ${deckPath}`)
console.log(`  → ${url}`)

if (args.open) {
  const { default: open } = await import('open')
  await open(url)
}
