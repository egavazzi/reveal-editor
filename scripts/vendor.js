// Copies the pinned reveal.js and KaTeX dists from node_modules into
// templates/reveal-dist/, which is committed to this repo and vendored into
// every scaffolded deck so decks stay standalone and offline-capable.
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'templates', 'reveal-dist')
const reveal = join(root, 'node_modules', 'reveal.js')
const katex = join(root, 'node_modules', 'katex', 'dist')

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

await cp(join(reveal, 'dist'), join(out, 'dist'), { recursive: true })
await cp(join(reveal, 'plugin'), join(out, 'plugin'), { recursive: true })

const katexOut = join(out, 'katex', 'dist')
await mkdir(join(katexOut, 'contrib'), { recursive: true })
await cp(join(katex, 'katex.min.js'), join(katexOut, 'katex.min.js'))
await cp(join(katex, 'katex.min.css'), join(katexOut, 'katex.min.css'))
await cp(join(katex, 'contrib', 'auto-render.min.js'), join(katexOut, 'contrib', 'auto-render.min.js'))
await cp(join(katex, 'contrib', 'mhchem.min.js'), join(katexOut, 'contrib', 'mhchem.min.js'))
await cp(join(katex, 'fonts'), join(katexOut, 'fonts'), { recursive: true })

console.log(`vendored reveal.js + katex into ${out}`)
