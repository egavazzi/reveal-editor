// Parsing helpers for resource references that appear in more than one place:
// `srcset` candidate lists and URL fragments.

const WHITESPACE = /[\t\n\f\r ]/

/**
 * Split a `srcset` attribute into `{ url, descriptor }` candidates following
 * the HTML parsing algorithm: a candidate URL runs to the next whitespace, so
 * a `data:` URL keeps its internal commas, and a comma directly after the URL
 * ends the candidate without a descriptor.
 */
export function parseSrcset(value) {
  const input = String(value ?? '')
  const candidates = []
  let at = 0
  while (at < input.length) {
    while (at < input.length && (WHITESPACE.test(input[at]) || input[at] === ',')) at += 1
    if (at >= input.length) break
    const urlStart = at
    while (at < input.length && !WHITESPACE.test(input[at])) at += 1
    let url = input.slice(urlStart, at)
    let descriptor = ''
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '')
    } else {
      while (at < input.length && WHITESPACE.test(input[at])) at += 1
      const descriptorStart = at
      // Parentheses hide commas: a media-condition descriptor such as
      // `(min-width: 40em)` must not be split in half.
      let depth = 0
      while (at < input.length) {
        const char = input[at]
        if (char === '(') depth += 1
        else if (char === ')') depth = Math.max(0, depth - 1)
        else if (char === ',' && depth === 0) break
        at += 1
      }
      descriptor = input.slice(descriptorStart, at).trim()
      if (input[at] === ',') at += 1
    }
    if (url) candidates.push({ url, descriptor })
  }
  return candidates
}

/** Serialize `{ url, descriptor }` candidates back into a `srcset` value. */
export function formatSrcset(candidates) {
  return candidates.map(({ url, descriptor }) => (descriptor ? `${url} ${descriptor}` : url)).join(', ')
}

/**
 * Split a reference into its resource part and its `#fragment`, which has to
 * survive embedding: `sprite.svg#icon` selects one symbol out of the file and
 * the same selection must still work on the produced `data:` URL.
 */
export function splitFragment(reference) {
  const hash = String(reference ?? '').indexOf('#')
  return hash === -1
    ? { resource: String(reference ?? ''), fragment: '' }
    : { resource: reference.slice(0, hash), fragment: reference.slice(hash) }
}
