// Deterministic HTML formatter for the .slides subtree.
//
// Guarantees:
//  - Idempotent: format(format(x)) === format(x)
//  - Whitespace-safe: only splits children onto separate lines when every
//    child is a block-level element and there is no text content, so
//    rendering is never changed by reformatting.
//  - Canonical attribute order and inline-style ordering for stable git diffs.
import { parseFragment, serialize } from 'parse5'

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr'
])

// Elements between which whitespace is insignificant (block layout).
const BLOCK_ELEMENTS = new Set([
  'section', 'div', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'blockquote', 'figure', 'figcaption', 'p', 'pre',
  'aside', 'header', 'footer', 'nav', 'article', 'main', 'form', 'fieldset',
  'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
])

// Content serialized verbatim (whitespace or raw text is significant inside).
const VERBATIM_CONTENT = new Set(['pre', 'textarea', 'script', 'style'])

// Canonical ordering for style declarations written by the editor.
const STYLE_KEY_ORDER = [
  'position', 'left', 'top', 'width', 'height', 'transform', 'z-index'
]

const ATTR_FIRST = ['id', 'class']
const ATTR_LAST = ['style']

function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/\u00a0/g, '&nbsp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/\u00a0/g, '&nbsp;').replace(/"/g, '&quot;')
}

function normalizeStyle(value) {
  const decls = value.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':')
    if (i === -1) return null
    return { key: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() }
  }).filter(Boolean)
  // Stable sort: known keys in canonical order first, unknown keys keep
  // their original relative order after them.
  const rank = (k) => {
    const i = STYLE_KEY_ORDER.indexOf(k)
    return i === -1 ? STYLE_KEY_ORDER.length : i
  }
  decls.sort((a, b) => rank(a.key) - rank(b.key) || 0)
  return decls.map((d) => `${d.key}: ${d.value}`).join('; ')
}

function attrSortKey(name) {
  const first = ATTR_FIRST.indexOf(name)
  if (first !== -1) return `0${first}`
  if (ATTR_LAST.includes(name)) return `2${name}`
  return `1${name}`
}

// Mutates the parse5 tree: sorts attributes, normalizes style attrs and
// class attr whitespace. Applied to every element before printing.
function normalizeTree(node) {
  if (node.attrs) {
    for (const attr of node.attrs) {
      if (attr.name === 'style') attr.value = normalizeStyle(attr.value)
      if (attr.name === 'class') attr.value = attr.value.trim().replace(/\s+/g, ' ')
    }
    node.attrs.sort((a, b) => {
      const ka = attrSortKey(a.name)
      const kb = attrSortKey(b.name)
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })
  }
  for (const child of node.childNodes ?? []) normalizeTree(child)
  // parse5 stores <template> content separately
  if (node.content) normalizeTree(node.content)
}

function printAttrs(node) {
  return node.attrs
    .map((a) => (a.value === '' ? ` ${a.name}` : ` ${a.name}="${escapeAttr(a.value)}"`))
    .join('')
}

function isWhitespaceText(node) {
  return node.nodeName === '#text' && /^[\s\n]*$/.test(node.value)
}

function isElement(node) {
  return !node.nodeName.startsWith('#')
}

// Children may be printed one-per-line only if that cannot change rendering:
// every child element is block-level and there is no visible text between them.
function canPrettyPrintChildren(node) {
  if (VERBATIM_CONTENT.has(node.tagName)) return false
  const children = node.childNodes ?? []
  const elements = children.filter(isElement)
  if (elements.length === 0) return false
  if (!children.every((c) => isElement(c) || isWhitespaceText(c))) return false
  return elements.every((c) => BLOCK_ELEMENTS.has(c.tagName))
}

// Serialize a node exactly (after normalization) using parse5, which
// preserves all internal whitespace. Used for inline/mixed content.
function serializeVerbatim(node) {
  return serialize({ nodeName: '#document-fragment', childNodes: [node] })
}

function printNode(node, indent, out) {
  if (node.nodeName === '#text') {
    if (!isWhitespaceText(node)) out.push(indent + escapeText(node.value).trim())
    return
  }
  if (node.nodeName === '#comment') {
    out.push(`${indent}<!--${node.data}-->`)
    return
  }
  if (!isElement(node)) return

  const open = `<${node.tagName}${printAttrs(node)}>`
  if (VOID_ELEMENTS.has(node.tagName)) {
    out.push(indent + open)
    return
  }
  const children = (node.childNodes ?? []).filter((c) => !isWhitespaceText(c) || VERBATIM_CONTENT.has(node.tagName))

  if (children.length === 0) {
    out.push(`${indent}${open}</${node.tagName}>`)
  } else if (canPrettyPrintChildren(node)) {
    out.push(indent + open)
    for (const child of node.childNodes) {
      if (isWhitespaceText(child)) continue
      printNode(child, indent + '  ', out)
    }
    out.push(`${indent}</${node.tagName}>`)
  } else {
    // Mixed or inline content: serialize the whole subtree verbatim so
    // whitespace semantics are untouched.
    const inner = serialize(node)
    out.push(`${indent}${open}${inner}</${node.tagName}>`)
  }
}

/**
 * Format an HTML fragment (the innerHTML of .slides) deterministically.
 * @param {string} html - fragment source
 * @param {string} baseIndent - indentation prefix for top-level nodes
 * @returns {string} formatted fragment, lines separated by \n, no trailing newline
 */
export function formatFragment(html, baseIndent = '') {
  const fragment = parseFragment(html)
  normalizeTree(fragment)
  const out = []
  for (const child of fragment.childNodes) {
    printNode(child, baseIndent, out)
  }
  return out.join('\n')
}
