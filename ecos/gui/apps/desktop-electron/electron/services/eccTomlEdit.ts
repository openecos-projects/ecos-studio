/**
 * Layout-preserving ecc.toml text editing.
 *
 * Mirrors the semantics of ECC's `chipcompiler/cli/project/toml_edit.py` so
 * GUI writes keep comments, ordering, and unknown keys intact instead of
 * reserializing the whole file. Edits are pure string functions; atomic
 * write and authorization live in projectEccConfigService.
 */

const TABLE_HEADER_RE = /^[ \t]*\[([^\]]+)\][ \t]*(?:#.*)?$/gm
// The key span may be blanked by string masking, so callers compare the
// ORIGINAL text's key token, not the masked match. Group 1 is the indent.
const ASSIGNMENT_LINE_RE = /^([ \t]*)[^=\n]+=[^\n]*$/gm

/** Semantic segments of a TOML dotted key (quotes stripped, dots in quotes kept). */
function splitDottedKey(raw: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of raw.trim()) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '.') {
      segments.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  segments.push(current.trim())
  return segments
}

function headerMatches(
  text: string,
  headerNameMatch: RegExpExecArray,
  tableName: string,
): boolean {
  const rawLine = text.slice(
    headerNameMatch.index,
    headerNameMatch.index + headerNameMatch[0].length,
  )
  const rawHeaderMatch = /^[ \t]*\[([^\]]+)\][ \t]*(?:#.*)?$/.exec(rawLine)
  if (!rawHeaderMatch) return false
  const rawHeader = rawHeaderMatch[1]
  return (
    splitDottedKey(rawHeader).join('\u0000') === splitDottedKey(tableName).join('\u0000')
  )
}

/**
 * Same-length text with string and comment contents blanked. Table-header
 * discovery must not mistake bracket text inside a multiline string for a
 * real `[table]` header; masking preserves every index and newline so
 * matches map back onto the original text.
 */
export function maskStringsAndComments(text: string): string {
  // JavaScript string indexes and RegExp match offsets are UTF-16 code units.
  // Keep the masked representation in that same coordinate system so astral
  // characters cannot shift every later table or assignment span.
  const chars = text.split('')
  let pos = 0
  const n = text.length
  while (pos < n) {
    const ch = text[pos]
    if (ch === '#') {
      const nl = text.indexOf('\n', pos)
      const end = nl === -1 ? n : nl
      for (let i = pos; i < end; i += 1) chars[i] = ' '
      pos = end
      continue
    }
    if (ch === '"' || ch === "'") {
      const triple = text.slice(pos, pos + 3)
      let end: number
      if (triple === '"""' || triple === "'''") {
        end = pos + 3
        while (end < n && !text.startsWith(triple, end)) end += 1
        end = Math.min(end + 3, n)
      } else {
        end = pos + 1
        while (end < n) {
          if (ch === '"' && text.startsWith('\\', end)) {
            end += 2
            continue
          }
          if (text[end] === ch) {
            end += 1
            break
          }
          end += 1
        }
      }
      for (let i = pos; i < Math.min(end, n); i += 1) {
        if (chars[i] !== '\n') chars[i] = ' '
      }
      pos = Math.max(end, pos + 1)
      continue
    }
    pos += 1
  }
  return chars.join('')
}

/** Return [bodyStart, bodyEnd] for a TOML table, or null. */
export function findTableSpan(text: string, tableName: string): [number, number] | null {
  const masked = maskStringsAndComments(text)
  TABLE_HEADER_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TABLE_HEADER_RE.exec(masked)) !== null) {
    if (!headerMatches(text, match, tableName)) continue
    const headerEnd = match.index + match[0].length
    const nl = text.indexOf('\n', headerEnd)
    const bodyStart = nl === -1 ? text.length : nl + 1
    TABLE_HEADER_RE.lastIndex = 0
    const nextHeader = TABLE_HEADER_RE.exec(masked.slice(bodyStart))
    const bodyEnd = nextHeader ? bodyStart + nextHeader.index : text.length
    return [bodyStart, bodyEnd]
  }
  return null
}

function findAssignment(
  maskedBody: string,
  originalBody: string,
  name: string,
): RegExpExecArray | null {
  ASSIGNMENT_LINE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ASSIGNMENT_LINE_RE.exec(maskedBody)) !== null) {
    const keyToken = originalBody
      .slice(match.index, match.index + match[0].length)
      .split('=', 1)[0]
    const segments = splitDottedKey(keyToken)
    if (segments.length === 1 && segments[0] === name) return match
  }
  return null
}

/**
 * End of the (possibly multiline) TOML value whose first line ends at
 * matchEnd: multiline strings, bracket collections, escapes, and comments
 * each terminate the value correctly so no tail is left behind.
 */
function extendMultilineValue(text: string, matchEnd: number): number {
  let pos = text.lastIndexOf('\n', matchEnd - 1) + 1
  const n = text.length
  let depth = 0
  let state: string | null = null
  while (pos < n) {
    const ch = text[pos]
    if (state === '"' || state === "'") {
      if (ch === '\\' && state === '"') {
        pos += 2
        continue
      }
      if (ch === state) state = null
      pos += 1
      continue
    }
    if (state === '"""' || state === "'''") {
      if (text.startsWith(state, pos)) {
        state = null
        pos += 3
      } else {
        pos += 1
      }
      continue
    }
    if (ch === '#') {
      const nl = text.indexOf('\n', pos)
      if (nl === -1) return n
      // At the top level a comment ends the value; inside a bracket
      // collection it decorates the line and the collection continues.
      if (depth <= 0) return nl + 1
      pos = nl + 1
      continue
    }
    if (ch === '"' || ch === "'") {
      const triple = text.slice(pos, pos + 3)
      if (triple === '"""' || triple === "'''") {
        state = triple
        pos += 3
      } else {
        state = ch
        pos += 1
      }
      continue
    }
    if (ch === '\n' && depth <= 0) return pos + 1
    if (ch === '[' || ch === '{') depth += 1
    else if (ch === ']' || ch === '}') depth -= 1
    pos += 1
  }
  return n
}

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
}

export function formatTomlValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    let out = ''
    for (const ch of value) {
      const escaped = ESCAPES[ch]
      if (escaped) out += escaped
      else if (ch.charCodeAt(0) < 0x20 || ch === '\x7f') {
        out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`
      } else out += ch
    }
    return `"${out}"`
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatTomlValue(item)).join(', ')}]`
  }
  throw new Error(`value has no TOML representation: ${String(value)}`)
}

function insertTable(text: string, tableName: string, line: string): string {
  const paramsSpan = findTableSpan(text, 'params')
  if (!paramsSpan) {
    return `${text.trimEnd()}\n\n[${tableName}]\n${line}\n`
  }
  const [, bodyEnd] = paramsSpan
  const masked = maskStringsAndComments(text)
  TABLE_HEADER_RE.lastIndex = 0
  const nextHeader = new RegExp(TABLE_HEADER_RE.source, 'gm').exec(masked.slice(bodyEnd))
  const insert = `\n\n[${tableName}]\n${line}`
  if (nextHeader) {
    const pos = bodyEnd + nextHeader.index
    return `${text.slice(0, pos)}${insert}\n${text.slice(pos)}`
  }
  return `${text}${insert}\n`
}

/** Set `name = value` inside `table`, preserving the surrounding layout. */
export function setScopedKey(
  text: string,
  table: string,
  name: string,
  value: unknown,
): string {
  const valueStr = formatTomlValue(value)
  const span = findTableSpan(text, table)
  if (!span) return insertTable(text, table, `${name} = ${valueStr}`)

  const [bodyStart, bodyEnd] = span
  const sectionBody = text.slice(bodyStart, bodyEnd)
  const maskedBody = maskStringsAndComments(sectionBody)
  const keyMatch = findAssignment(maskedBody, sectionBody, name)
  if (!keyMatch) {
    return `${text.slice(0, bodyStart)}${name} = ${valueStr}\n${text.slice(bodyStart)}`
  }
  const indent = keyMatch[1]
  const end = extendMultilineValue(sectionBody, keyMatch.index + keyMatch[0].length)
  const replacementEnd = keyMatch.index + keyMatch[0].length
  let newLine = `${indent}${name} = ${valueStr}`
  if (end > replacementEnd) newLine += '\n'
  const newBody = sectionBody.slice(0, keyMatch.index) + newLine + sectionBody.slice(end)
  return text.slice(0, bodyStart) + newBody + text.slice(bodyEnd)
}

/**
 * Remove `name` from `table`. Returns null when the key is absent. A table
 * left with no keys is removed together with its header.
 */
export function removeScopedKey(
  text: string,
  table: string,
  name: string,
): string | null {
  const span = findTableSpan(text, table)
  if (!span) return null

  const [bodyStart, bodyEnd] = span
  const sectionBody = text.slice(bodyStart, bodyEnd)
  const maskedBody = maskStringsAndComments(sectionBody)
  const keyMatch = findAssignment(maskedBody, sectionBody, name)
  if (!keyMatch) return null

  const end = extendMultilineValue(sectionBody, keyMatch.index + keyMatch[0].length)
  const newBody = sectionBody.slice(0, keyMatch.index) + sectionBody.slice(end)
  const hasRemainingKeys = newBody.split('\n').some((line) => line.trim().length > 0)
  if (!hasRemainingKeys) {
    const masked = maskStringsAndComments(text)
    TABLE_HEADER_RE.lastIndex = 0
    let headerMatch: RegExpExecArray | null = null
    let candidate: RegExpExecArray | null
    while ((candidate = TABLE_HEADER_RE.exec(masked)) !== null) {
      if (headerMatches(text, candidate, table)) {
        headerMatch = candidate
        break
      }
    }
    if (!headerMatch) return null
    const headerStart = headerMatch.index
    const result = `${text.slice(0, headerStart).trimEnd()}\n${text.slice(bodyEnd).replace(/^\n+/, '')}`
    return result.trim().length > 0 ? result : null
  }
  return text.slice(0, bodyStart) + newBody + text.slice(bodyEnd)
}
