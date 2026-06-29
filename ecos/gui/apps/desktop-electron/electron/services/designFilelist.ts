import { isAbsoluteLocalPath, isHdlFilePath, joinLocalPath, normalizeLocalPath } from '@ecos-studio/shared'

export type FilelistLine =
  | { kind: 'file'; raw: string; path: string }
  | { kind: 'other'; raw: string }

export { isHdlFilePath }

export function parseFilelistContent(content: string): FilelistLine[] {
  const lines: FilelistLine[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed) {
      lines.push({ kind: 'other', raw: rawLine })
      continue
    }

    if (
      trimmed.startsWith('#')
      || trimmed.startsWith('//')
      || trimmed.startsWith('`')
    ) {
      lines.push({ kind: 'other', raw: rawLine })
      continue
    }

    if (trimmed.startsWith('+incdir+')) {
      lines.push({ kind: 'other', raw: rawLine })
      continue
    }

    if (trimmed.startsWith('+') || trimmed.startsWith('-')) {
      lines.push({ kind: 'other', raw: rawLine })
      continue
    }

    const path = extractPathValue(trimmed)
    if (!path) {
      lines.push({ kind: 'other', raw: rawLine })
      continue
    }

    lines.push({ kind: 'file', raw: rawLine, path })
  }

  return lines
}

export function serializeFilelistLines(lines: FilelistLine[]): string {
  const serialized = lines.map((line) => line.raw)
  const trailingNewline = serialized.length > 0 && serialized[serialized.length - 1] !== ''
    ? '\n'
    : ''
  return `${serialized.join('\n')}${trailingNewline}`
}

export function resolveFilelistPath(entryPath: string, filelistDir: string): string {
  const trimmed = entryPath.trim()
  if (isAbsoluteLocalPath(trimmed)) {
    return normalizeLocalPath(trimmed)
  }
  return joinLocalPath(filelistDir, trimmed)
}

export function formatFilelistEntry(relativePath: string): string {
  if (/\s/.test(relativePath)) {
    return `"${relativePath}"`
  }
  return relativePath
}

export function appendFilelistEntry(lines: FilelistLine[], relativePath: string): FilelistLine[] {
  const entry = formatFilelistEntry(relativePath)
  const next = [...lines]
  if (next.length > 0 && next[next.length - 1]?.raw !== '') {
    next.push({ kind: 'other', raw: '' })
  }
  next.push({ kind: 'file', raw: entry, path: relativePath })
  return next
}

export function removeFilelistEntry(lines: FilelistLine[], filelistEntry: string): FilelistLine[] {
  return lines.filter((line) => !(line.kind === 'file' && line.raw === filelistEntry))
}

function extractPathValue(line: string): string {
  const withoutComment = stripInlineComment(line).trim()
  if (!withoutComment) return ''

  const quote = withoutComment[0]
  if (quote === '"' || quote === '\'') {
    const closingIndex = withoutComment.indexOf(quote, 1)
    if (closingIndex > 1) {
      return withoutComment.slice(1, closingIndex)
    }
    return withoutComment.slice(1)
  }

  return withoutComment.split(/\s+/)[0] ?? ''
}

function stripInlineComment(line: string): string {
  const hashIndex = line.indexOf('#')
  const slashIndex = line.indexOf('//')
  let cutIndex = -1

  if (hashIndex >= 0) cutIndex = hashIndex
  if (slashIndex >= 0 && (cutIndex < 0 || slashIndex < cutIndex)) {
    cutIndex = slashIndex
  }

  if (cutIndex < 0) return line
  return line.slice(0, cutIndex)
}
