import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ejectQuartoHtml } from '../../src/server/scaffold.js'

describe('Quarto eject', () => {
  it('copies rendered reveal HTML and local referenced assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reveal-eject-'))
    const source = join(root, 'source')
    const target = join(root, 'target')
    await mkdir(join(source, 'talk_files'), { recursive: true })
    await writeFile(join(source, 'talk_files', 'plot.svg'), '<svg></svg>')
    await writeFile(join(source, 'talk_files', 'dynamically-loaded.js'), 'window.dynamic = true')
    await writeFile(join(source, 'talk.html'), '<div class="reveal"><div class="slides"><section><img src="talk_files/plot.svg"></section></div></div>')

    const deck = await ejectQuartoHtml(join(source, 'talk.html'), target)
    expect(await readFile(deck, 'utf8')).toContain('talk_files/plot.svg')
    expect(await readFile(join(target, 'talk_files', 'plot.svg'), 'utf8')).toBe('<svg></svg>')
    expect(await readFile(join(target, 'talk_files', 'dynamically-loaded.js'), 'utf8')).toContain('dynamic')
    expect(await readFile(join(target, 'EJECTED_FROM_QUARTO.md'), 'utf8')).toContain('future `quarto render`')
  })

  it('rejects non-reveal HTML', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reveal-eject-invalid-'))
    const input = join(root, 'page.html')
    await writeFile(input, '<h1>ordinary page</h1>')
    await expect(ejectQuartoHtml(input, join(root, 'out'))).rejects.toThrow('reveal.js presentation')
  })
})
