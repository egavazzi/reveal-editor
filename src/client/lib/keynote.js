import { strToU8, zipSync } from 'fflate'

const EXTENSION_BY_MIME = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm'
}

function safeName(value, fallback = 'Keynote presentation') {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || fallback
}

function bytesToDataUrl(bytes, mimeType) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

function setPosition(el, item) {
  Object.assign(el.style, {
    position: 'absolute',
    left: `${item.x || 0}px`,
    top: `${item.y || 0}px`,
    width: `${Math.max(1, item.width || 1)}px`,
    height: `${Math.max(1, item.height || 1)}px`,
    boxSizing: 'border-box',
    zIndex: String(item.zIndex ?? 1)
  })
  if (item.angle) el.style.transform = `rotate(${item.angle}rad)`
}

function appendRichText(doc, parent, block) {
  if (!block.paragraphs?.length) {
    parent.textContent = block.text || ''
    return
  }
  for (const paragraph of block.paragraphs) {
    const row = doc.createElement('div')
    Object.assign(row.style, {
      display: paragraph.bullet ? 'grid' : 'block',
      gridTemplateColumns: paragraph.bullet ? '1.5em minmax(0, 1fr)' : '',
      marginTop: `${paragraph.spaceBefore || 0}px`,
      marginBottom: `${paragraph.spaceAfter || 0}px`,
      color: paragraph.color || 'inherit',
      fontWeight: paragraph.bold ? '700' : 'inherit',
      fontStyle: paragraph.italic ? 'italic' : 'inherit'
    })
    if (paragraph.bullet) {
      const bullet = doc.createElement('span')
      bullet.textContent = '•'
      row.appendChild(bullet)
    }
    const content = doc.createElement('span')
    for (const run of paragraph.runs || []) {
      const span = doc.createElement('span')
      span.textContent = run.text || ''
      if (run.color) span.style.color = run.color
      if (run.bold) span.style.fontWeight = '700'
      if (run.italic) span.style.fontStyle = 'italic'
      content.appendChild(span)
    }
    row.appendChild(content)
    parent.appendChild(row)
  }
}

function appendText(doc, section, block) {
  const plainText = block.paragraphs?.length
    ? block.paragraphs.flatMap((paragraph) => paragraph.runs || []).map((run) => run.text || '').join('')
    : block.text || ''
  // Keynote uses the object-replacement character for inline attachments.
  // The corresponding visual object is imported separately; an otherwise
  // empty text box would only leave a visible tofu glyph.
  if (!plainText.replace(/\uFFFC/g, '').trim()) return
  const el = doc.createElement('div')
  el.className = 're-el re-text'
  const fontSize = block.fontSize || 16
  const lineHeight = block.lineHeight == null ? 1.15 : Number(block.lineHeight)
  const charactersPerLine = Math.max(1, (block.width || 1) / (fontSize * 0.48))
  const estimatedLines = Math.max(1, plainText.split(/\r?\n/).reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0
  ))
  const paddingHeight = (block.padding?.top || 0) + (block.padding?.bottom || 0)
  const fittedHeight = Math.max(block.height || 1, Math.ceil(estimatedLines * fontSize * lineHeight + paddingHeight))
  setPosition(el, { ...block, height: fittedHeight })
  Object.assign(el.style, {
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: `${fontSize}px`,
    fontFamily: block.fontFamily || 'inherit',
    color: block.color || 'inherit',
    fontWeight: block.bold ? '700' : '400',
    fontStyle: block.italic ? 'italic' : 'normal',
    textAlign: block.align || 'left',
    letterSpacing: block.letterSpacing == null ? 'normal' : `${block.letterSpacing}em`,
    lineHeight: String(lineHeight),
    display: block.verticalAlign ? 'flex' : 'block',
    flexDirection: block.verticalAlign ? 'column' : '',
    justifyContent: block.verticalAlign === 'middle'
      ? 'center'
      : block.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
    padding: block.padding
      ? `${block.padding.top}px ${block.padding.right}px ${block.padding.bottom}px ${block.padding.left}px`
      : '0'
  })
  appendRichText(doc, el, block)
  section.appendChild(el)
}

function appendChart(doc, section, object) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = doc.createElementNS(ns, 'svg')
  svg.setAttribute('class', 're-el')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', object.chart ? 'Imported Keynote chart' : 'Keynote chart preview unavailable')
  svg.setAttribute('viewBox', `0 0 ${object.width} ${object.height}`)
  setPosition(svg, object)
  const values = object.chart?.series?.flatMap((series) => series.values).filter(Number.isFinite) || []
  const categories = object.chart?.categories || []
  if (!values.length || !categories.length) {
    section.appendChild(svg)
    return
  }
  const maximum = Math.max(25, Math.ceil(Math.max(...values, 0) / 25) * 25)
  const colors = ['#0b9fe8', '#58d52f', '#f5a623', '#9b59b6', '#ef4444', '#14b8a6']
  const add = (tag, attrs) => {
    const node = doc.createElementNS(ns, tag)
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value))
    svg.appendChild(node)
    return node
  }
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = object.height - object.height * tick / 4
    add('line', { x1: 0, y1: y, x2: object.width, y2: y, stroke: tick ? '#b7b7b7' : '#111', 'stroke-width': tick ? 0.6 : 1.2 })
  }
  const groupWidth = object.width / categories.length
  if (object.chart.type === 'bar') {
    const usableWidth = groupWidth * 0.82
    const barWidth = usableWidth / object.chart.series.length
    categories.forEach((_category, categoryIndex) => {
      object.chart.series.forEach((series, seriesIndex) => {
        const value = Number(series.values[categoryIndex] || 0)
        const height = Math.max(0, Math.min(object.height, value / maximum * object.height))
        add('rect', {
          x: categoryIndex * groupWidth + (groupWidth - usableWidth) / 2 + seriesIndex * barWidth,
          y: object.height - height,
          width: Math.max(1, barWidth - 2),
          height,
          fill: colors[seriesIndex % colors.length]
        })
      })
    })
  } else {
    object.chart.series.forEach((series, seriesIndex) => {
      const points = series.values.map((value, index) => {
        const y = object.height - Math.max(0, Math.min(object.height, Number(value || 0) / maximum * object.height))
        return `${index * groupWidth + groupWidth / 2},${y}`
      }).join(' ')
      add('polyline', { points, fill: 'none', stroke: colors[seriesIndex % colors.length], 'stroke-width': 3 })
    })
  }
  section.appendChild(svg)
}

function appendTable(doc, section, table) {
  const el = doc.createElement('table')
  el.className = 're-el'
  setPosition(el, { ...table, width: table.width || 400, height: table.height || 200 })
  Object.assign(el.style, {
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
    background: '#fff',
    fontSize: `${table.fontSize || 14}px`,
    fontFamily: table.fontFamily || 'inherit'
  })
  if (table.columnWidths?.length) {
    const columns = doc.createElement('colgroup')
    for (const width of table.columnWidths) {
      const column = doc.createElement('col')
      column.style.width = `${width}px`
      columns.appendChild(column)
    }
    el.appendChild(columns)
  }
  const origins = new Map((table.merges || []).map((merge) => [`${merge.row}:${merge.col}`, merge]))
  const covered = new Set()
  for (const merge of table.merges || []) {
    for (let row = merge.row; row < merge.row + merge.rowspan; row += 1) {
      for (let col = merge.col; col < merge.col + merge.colspan; col += 1) {
        if (row !== merge.row || col !== merge.col) covered.add(`${row}:${col}`)
      }
    }
  }
  table.rows.forEach((row, rowIndex) => {
    const tr = doc.createElement('tr')
    if (table.rowHeights?.[rowIndex]) tr.style.height = `${table.rowHeights[rowIndex]}px`
    row.forEach((value, colIndex) => {
      if (covered.has(`${rowIndex}:${colIndex}`)) return
      const cell = doc.createElement('td')
      cell.textContent = value
      Object.assign(cell.style, { padding: '0 6px', border: `1px solid ${table.borderColor || '#aaa'}`, overflow: 'hidden' })
      if (rowIndex < (table.headerRows || 0)) {
        cell.style.fontWeight = '700'
        if (table.headerRowBackground) cell.style.background = table.headerRowBackground
      }
      if (colIndex < (table.headerColumns || 0) && rowIndex >= (table.headerRows || 0)) {
        cell.style.fontWeight = '700'
        if (table.headerColumnBackground) cell.style.background = table.headerColumnBackground
      }
      const merge = origins.get(`${rowIndex}:${colIndex}`)
      if (merge) {
        cell.rowSpan = merge.rowspan
        cell.colSpan = merge.colspan
      }
      tr.appendChild(cell)
    })
    el.appendChild(tr)
  })
  section.appendChild(el)
}

/** Turn the parsed Keynote model into editable reveal-editor HTML. */
export function keynoteModelToReveal(model, templateHtml, { inlineAssets = false } = {}) {
  if (model.kind !== 'keynote') throw new Error('This is not a Keynote presentation.')
  if (!model.scenes?.length) throw new Error('No slides could be read from this Keynote presentation.')

  const doc = new DOMParser().parseFromString(templateHtml, 'text/html')
  const slides = doc.querySelector('.reveal .slides')
  if (!slides) throw new Error('The presentation template is invalid.')
  slides.replaceChildren()
  const assets = []
  const assetRef = (object, slideIndex, objectIndex) => {
    if (!object.bytes?.length || !object.mimeType) return ''
    if (inlineAssets) return bytesToDataUrl(object.bytes, object.mimeType)
    const ext = EXTENSION_BY_MIME[object.mimeType] || 'bin'
    const path = `assets/keynote-slide-${String(slideIndex + 1).padStart(3, '0')}-${String(objectIndex + 1).padStart(3, '0')}.${ext}`
    assets.push({ path, bytes: Uint8Array.from(object.bytes) })
    return path
  }

  model.scenes.forEach((scene, slideIndex) => {
    const section = doc.createElement('section')
    section.className = 're-slide'
    section.setAttribute('data-background-color', '#ffffff')

    if (model.limitedPreview && slideIndex === 0 && model.preview?.bytes?.length) {
      const preview = doc.createElement('img')
      preview.className = 're-el'
      preview.alt = 'Embedded Keynote preview'
      preview.src = assetRef(model.preview, slideIndex, 0)
      setPosition(preview, { x: 0, y: 0, width: scene.width, height: scene.height, zIndex: 0 })
      preview.style.objectFit = 'contain'
      section.appendChild(preview)
    }

    scene.objects?.filter((object) => object.kind !== 'table').forEach((object, objectIndex) => {
      if (object.kind === 'chart') {
        appendChart(doc, section, object)
        return
      }
      if (object.kind === 'image' && object.bytes?.length && object.mimeType) {
        const image = doc.createElement('img')
        image.className = 're-el'
        image.alt = object.text || 'Imported Keynote image'
        image.src = assetRef(object, slideIndex, objectIndex + 1)
        setPosition(image, object)
        image.style.objectFit = 'fill'
        section.appendChild(image)
        return
      }
      if (object.kind === 'media' && object.bytes?.length && object.mimeType?.startsWith('video/')) {
        const video = doc.createElement('video')
        video.className = 're-el'
        video.src = assetRef(object, slideIndex, objectIndex + 1)
        video.controls = true
        video.preload = 'metadata'
        setPosition(video, object)
        section.appendChild(video)
        return
      }
      // The parser cannot recover the appearance of every Keynote-native
      // shape. Do not cover the slide with an invented dark placeholder when
      // there is no text or media the editor can preserve.
      if (!object.text?.trim()) return
      const shape = doc.createElement('div')
      shape.className = 're-el re-text'
      shape.textContent = object.text || ''
      setPosition(shape, object)
      Object.assign(shape.style, {
        overflow: 'hidden',
        borderRadius: '14px',
        background: '#111827',
        color: '#fff',
        display: 'grid',
        placeItems: 'center'
      })
      section.appendChild(shape)
    })
    scene.blocks?.forEach((block) => appendText(doc, section, block))
    scene.tables?.forEach((table) => appendTable(doc, section, table))
    if (scene.notes?.length) {
      const notes = doc.createElement('aside')
      notes.className = 'notes'
      notes.textContent = scene.notes.join('\n')
      section.appendChild(notes)
    }
    slides.appendChild(section)
  })

  const first = model.scenes[0]
  const settings = doc.createElement('template')
  settings.setAttribute('data-re-settings', '')
  settings.innerHTML = JSON.stringify({
    width: Number(first.width) || 960,
    height: Number(first.height) || 540,
    margin: 0,
    showGrid: false,
    snapGrid: false,
    gridSize: 20,
    controls: true,
    slideNumbers: false,
    slideNumberFormat: 'c/t',
    slideNumberPosition: 'bottom-right',
    theme: 'white',
    typography: '',
    transition: 'none',
    transitionSpeed: 'default',
    laserPointer: false,
    clickZoom: false,
    mouseWheel: false,
    loop: false,
    autoSlide: 0,
    letterbox: true
  }, null, 2).replace(/</g, '\\u003c')
  slides.prepend(settings)
  const title = safeName(model.title)
  doc.title = title
  return {
    html: `<!doctype html>\n${doc.documentElement.outerHTML}`,
    title,
    assets,
    slideCount: model.scenes.length,
    limitedPreview: Boolean(model.limitedPreview),
    warnings: [...(model.diagnostics || []), ...(model.limits || [])]
  }
}

export async function readKeynote(file, templateHtml, options = {}) {
  const { parseIworkDocument } = await import('@file-viewer/renderer-iwork/parser')
  const model = await parseIworkDocument(await file.arrayBuffer(), 'key')
  return keynoteModelToReveal(model, templateHtml, options)
}

export function keynoteArchiveBytes(converted) {
  const files = { 'deck.html': strToU8(converted.html) }
  for (const asset of converted.assets) files[asset.path] = asset.bytes
  return zipSync(files, { level: 0 })
}

export function keynoteArchive(converted) {
  const filename = `${safeName(converted.title).replace(/\s+/g, '-')}.zip`
  return new File([keynoteArchiveBytes(converted)], filename, { type: 'application/zip' })
}
