const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])

const DROP_CONTENT_TAGS = new Set([
  'base',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'meta',
  'noscript',
  'object',
  'script',
  'select',
  'style',
  'template',
  'textarea',
])

const GLOBAL_ATTRS = new Set(['aria-hidden', 'aria-label', 'class', 'role', 'title'])

const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'rel', 'target']),
  col: new Set(['span', 'width']),
  colgroup: new Set(['span', 'width']),
  img: new Set(['alt', 'height', 'src', 'width']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
}

const INTEGER_ATTRS = new Set(['colspan', 'height', 'rowspan', 'span', 'width'])

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function sanitizeClassList(value: string): string {
  return value
    .split(/\s+/)
    .filter(token => /^[A-Za-z0-9:_-]+$/.test(token))
    .join(' ')
}

export function sanitizeUrl(value: string, attr: 'href' | 'src'): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const normalized = trimmed.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase()
  if (
    normalized.startsWith('javascript:') ||
    normalized.startsWith('vbscript:') ||
    normalized.startsWith('data:text/html')
  ) {
    return null
  }

  if (attr === 'src' && normalized.startsWith('data:')) {
    return normalized.startsWith('data:image/') ? trimmed : null
  }

  if (
    normalized.startsWith('http:') ||
    normalized.startsWith('https:') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:') ||
    normalized.startsWith('blob:') ||
    normalized.startsWith('asset:') ||
    normalized.startsWith('#') ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../')
  ) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed, 'https://sanitizer.local')
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'mailto:' ||
      parsed.protocol === 'tel:'
    ) {
      return trimmed
    }
  } catch {
    return null
  }

  return null
}

function sanitizeAttribute(
  tag: string,
  name: string,
  value: string,
): [string, string] | null {
  if (name.startsWith('on')) return null

  const allowedForTag = TAG_ATTRS[tag]
  if (!GLOBAL_ATTRS.has(name) && !(allowedForTag && allowedForTag.has(name))) {
    return null
  }

  if (name === 'class') {
    const classes = sanitizeClassList(value)
    return classes ? ['class', classes] : null
  }

  if (name === 'href' || name === 'src') {
    const safe = sanitizeUrl(value, name)
    return safe ? [name, safe] : null
  }

  if (name === 'target') {
    return value === '_blank' || value === '_self' ? ['target', value] : null
  }

  if (name === 'rel') {
    return null
  }

  if (INTEGER_ATTRS.has(name)) {
    return /^\d+$/.test(value) ? [name, value] : null
  }

  return [name, value]
}

function sanitizeNode(
  node: Node,
  doc: Document,
  parent: Node,
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.appendChild(doc.createTextNode(node.textContent ?? ''))
    return
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return
  }

  const element = node as Element
  const tag = element.tagName.toLowerCase()

  if (DROP_CONTENT_TAGS.has(tag)) {
    return
  }

  if (!ALLOWED_TAGS.has(tag)) {
    for (const child of Array.from(element.childNodes)) {
      sanitizeNode(child, doc, parent)
    }
    return
  }

  const clean = doc.createElement(tag)

  for (const attr of Array.from(element.attributes)) {
    const sanitized = sanitizeAttribute(tag, attr.name.toLowerCase(), attr.value)
    if (!sanitized) continue
    clean.setAttribute(sanitized[0], sanitized[1])
  }

  if (tag === 'a' && clean.hasAttribute('href')) {
    const target = clean.getAttribute('target')
    if (target === '_blank') {
      clean.setAttribute('rel', 'noopener noreferrer')
    }
  }

  if (tag === 'img' && !clean.hasAttribute('src')) {
    return
  }

  for (const child of Array.from(element.childNodes)) {
    sanitizeNode(child, doc, clean)
  }

  parent.appendChild(clean)
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''

  if (typeof DOMParser === 'undefined') {
    return escapeHtml(html)
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const container = doc.createElement('div')

  for (const child of Array.from(doc.body.childNodes)) {
    sanitizeNode(child, doc, container)
  }

  return container.innerHTML
}
