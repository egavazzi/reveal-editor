import { describe, expect, it } from 'vitest'
import { importableSlides } from '../../src/client/lib/import-deck.js'

const deck = (slides) =>
  `<!doctype html><html><body><div class="reveal"><div class="slides">${slides}</div></div></body></html>`

describe('importable slides', () => {
  it('drops scripts, event handlers and script-bearing URLs', () => {
    const html = importableSlides(deck(`
      <section onclick="steal()">
        <script>steal()<\/script>
        <p>Kept</p>
        <a href="javascript:steal()">link</a>
        <iframe srcdoc="<script>steal()<\/script>"></iframe>
        <img src="data:text/html,<script>steal()<\/script>">
      </section>`))

    expect(html).toContain('Kept')
    expect(html).not.toContain('steal()')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('srcdoc')
  })

  it('keeps embedded and remote references', () => {
    const html = importableSlides(deck(
      '<section data-background-image="data:image/png;base64,AAA"><img src="https://example.test/x.png"></section>'
    ))
    expect(html).toContain('data:image/png;base64,AAA')
    expect(html).toContain('https://example.test/x.png')
  })

  it('refuses a deck whose assets were not embedded', () => {
    expect(() => importableSlides(deck('<section><img src="images/plot.png"></section>')))
      .toThrow('images/plot.png')
  })

  it('refuses a document that is not a presentation', () => {
    expect(() => importableSlides('<!doctype html><html><body><h1>Not a deck</h1></body></html>'))
      .toThrow('no reveal.js slides element')
  })
})
