export function normalizeFrontendFilelistToken(
  line: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const withoutComment = line.replace(/\/\/.*$/, '').trim()
  if (!withoutComment || withoutComment.startsWith('+define+')) return ''
  const parts = splitFrontendFilelistFields(withoutComment, platform)
  const first = parts[0] ?? ''
  const second = parts[1] ?? ''
  if (first === '-f' && second) return `-f${second}`
  return first
}

/** Split one filelist entry while preserving paths quoted because they contain spaces. */
function splitFrontendFilelistFields(line: string, platform: NodeJS.Platform): string[] {
  const fields: string[] = []
  let field = ''
  let quote: 'single' | 'double' | null = null
  let escaped = false

  for (const character of line) {
    if (escaped) {
      field += character
      escaped = false
      continue
    }
    // Windows uses literal backslashes, including the UNC prefix and trailing
    // directory separators. POSIX filelists retain their shell-style escapes.
    if (character === '\\' && quote !== 'single' && platform !== 'win32') {
      escaped = true
      continue
    }
    if (quote === 'single') {
      if (character === "'") quote = null
      else field += character
      continue
    }
    if (quote === 'double') {
      if (character === '"') quote = null
      else field += character
      continue
    }
    if (character === "'") {
      quote = 'single'
    } else if (character === '"') {
      quote = 'double'
    } else if (/\s/.test(character)) {
      if (field) {
        fields.push(field)
        field = ''
      }
    } else {
      field += character
    }
  }
  if (escaped) field += '\\'
  if (field) fields.push(field)
  return fields
}
