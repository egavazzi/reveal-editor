import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { scaffoldDeck } from '../src/server/scaffold.js'
import { createServer } from '../src/server/index.js'

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const port = Number(process.env.GECKODRIVER_PORT || 4460)
const driverUrl = `http://127.0.0.1:${port}`
const geckodriver = process.env.GECKODRIVER || 'geckodriver'
let driver
let sessionId
let server
let root
let editorUrl

async function request(path, options = {}) {
  const response = await fetch(`${driverUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  })
  const body = await response.json()
  if (body.value?.error) throw new Error(`${body.value.error}: ${body.value.message}`)
  return body.value
}

async function execute(script) {
  return request(`/session/${sessionId}/execute/sync`, {
    method: 'POST', body: JSON.stringify({ script, args: [] })
  })
}

async function executeAsync(script) {
  return request(`/session/${sessionId}/execute/async`, {
    method: 'POST', body: JSON.stringify({ script, args: [] })
  })
}

async function waitFor(check, message, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await check()) return
    } catch {}
    await delay(100)
  }
  throw new Error(`Timed out: ${message}`)
}

try {
  root = await mkdtemp(join(tmpdir(), 'reveal-editor-browser-'))
  const deckPath = await scaffoldDeck(join(root, 'deck'))
  ;({ server, url: editorUrl } = await createServer({
    deckPath, port: 0, dev: false, repoRoot: resolve('.')
  }))

  driver = spawn(geckodriver, ['--port', String(port)], { stdio: 'ignore' })
  await waitFor(async () => (await fetch(`${driverUrl}/status`)).ok, 'GeckoDriver startup')
  const session = await request('/session', {
    method: 'POST',
    body: JSON.stringify({
      capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } } }
    })
  })
  sessionId = session.sessionId
  await request(`/session/${sessionId}/url`, {
    method: 'POST', body: JSON.stringify({ url: editorUrl })
  })
  await waitFor(() => execute('return !!document.querySelector("iframe")?.contentWindow?.Reveal?.isReady()'), 'editor attach')
  await waitFor(() => execute(`
    return !document.querySelector('button[title="Text box"]')?.closest('.group')?.classList.contains('disabled');
  `), 'editor controls enabled')

  const media = await executeAsync(`
    const done = arguments[arguments.length - 1];
    const doc = document.querySelector('iframe').contentDocument;
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>'], 'smoke.svg', { type: 'image/svg+xml' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    doc.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    let attempts = 0;
    const check = () => {
      const image = doc.querySelector('section.present img[src^="assets/"]');
      if (image) done(image.getAttribute('src'));
      else if (++attempts > 200) done(null);
      else setTimeout(check, 50);
    };
    check();
  `)
  if (!media) throw new Error('Media drop did not produce an uploaded slide image')

  await execute(`
    document.querySelector('button[title="Deck, grid and presentation settings"]').click();
    return true;
  `)
  await delay(50)
  await execute(`
    const selects = [...document.querySelectorAll('select')];
    const theme = selects.find(s => s.parentElement.textContent.includes('Theme'));
    const typography = selects.find(s => s.parentElement.textContent.includes('Typography'));
    theme.value = 'moon'; theme.dispatchEvent(new Event('change', { bubbles: true }));
    typography.value = 'serif'; typography.dispatchEvent(new Event('change', { bubbles: true }));
    const layout = document.querySelector('select[title="New slide layout"]');
    layout.value = 'two-column'; layout.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('button[title="Add slide with selected layout"]').click();
    return true;
  `)
  await waitFor(() => execute(`
    const frame = document.querySelector('iframe'), doc = frame.contentDocument;
    return doc.querySelector('link[href*="/theme/"]')?.getAttribute('href').includes('/moon.css') &&
      getComputedStyle(doc.querySelector('section.present h2')).fontFamily.includes('Georgia') &&
      frame.contentWindow.Reveal.getSlides().length === 2;
  `), 'theme and typography preview')
  const live = await execute(`
    const frame = document.querySelector('iframe'), doc = frame.contentDocument;
    return {
      theme: doc.querySelector('link[href*="/theme/"]').getAttribute('href'),
      font: getComputedStyle(doc.querySelector('section.present h2')).fontFamily,
      slides: frame.contentWindow.Reveal.getSlides().length
    };
  `)
  if (!live.theme.includes('/moon.css') || !live.font.includes('Georgia') || live.slides !== 2) {
    throw new Error(`Live preview mismatch: ${JSON.stringify(live)}`)
  }

  await execute(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click(); return true;`)
  await waitFor(() => execute('return document.body.textContent.includes("Saved at")'), 'save completion')
  await request(`/session/${sessionId}/url`, {
    method: 'POST', body: JSON.stringify({ url: `${editorUrl}deck/deck.html#/1` })
  })
  await waitFor(() => execute(`
    return Reveal.isReady() &&
      document.querySelector('link[href*="/theme/"]')?.href.includes('/moon.css') &&
      getComputedStyle(document.querySelector('section.present h2')).fontFamily.includes('Georgia');
  `), 'standalone theme reload')
  const saved = await execute(`
    return {
      ready: Reveal.isReady(),
      theme: document.querySelector('link[href*="/theme/"]').href,
      font: getComputedStyle(document.querySelector('section.present h2')).fontFamily,
      slides: Reveal.getSlides().length,
      media: document.querySelector('img[src^="assets/"]')?.getAttribute('src'),
      stored: JSON.parse(document.querySelector('template[data-re-settings]').innerHTML)
    };
  `)
  if (!saved.ready || !saved.theme.includes('/moon.css') || !saved.font.includes('Georgia') ||
      saved.slides !== 2 || !saved.media || saved.stored.theme !== 'moon') {
    throw new Error(`Saved presentation mismatch: ${JSON.stringify(saved)}`)
  }
  console.log('Firefox smoke test passed: live preview, save, and standalone reload')
} finally {
  if (sessionId) await request(`/session/${sessionId}`, { method: 'DELETE' }).catch(() => {})
  driver?.kill('SIGTERM')
  if (server) await new Promise((resolvePromise) => server.close(resolvePromise))
  if (root) await rm(root, { recursive: true, force: true })
}
