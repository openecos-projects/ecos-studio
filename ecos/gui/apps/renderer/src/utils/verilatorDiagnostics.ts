export interface VerilatorDiagnostic {
  severity: 'error' | 'warning'
  code: string
  file: string
  line: number
  column: number
  message: string
  raw: string
}

export interface VerilatorDiagnosticCounts {
  errors: number
  warnings: number
}

const DIAGNOSTIC_RE = /^%(Error|Warning)(?:-([A-Za-z0-9_]+))?:\s+(.+?):(\d+):(?:(\d+):)?\s*(.*)$/

export function parseVerilatorDiagnostics(text: string): VerilatorDiagnostic[] {
  const diagnostics: VerilatorDiagnostic[] = []
  const seen = new Set<string>()

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const match = line.match(DIAGNOSTIC_RE)
    if (!match) continue

    const severity = match[1].toLowerCase() === 'error' ? 'error' : 'warning'
    const code = match[2] || severity.toUpperCase()
    const file = match[3].trim()
    const lineNumber = Number.parseInt(match[4], 10)
    const column = match[5] ? Number.parseInt(match[5], 10) : 1
    const message = (match[6] || '').trim()
    if (!file || !Number.isFinite(lineNumber)) continue

    const key = `${severity}:${code}:${normalizePath(file)}:${lineNumber}:${column}:${message}`
    if (seen.has(key)) continue
    seen.add(key)

    diagnostics.push({
      severity,
      code,
      file,
      line: Math.max(1, lineNumber),
      column: Math.max(1, Number.isFinite(column) ? column : 1),
      message,
      raw: line,
    })
  }

  return diagnostics
}

export function countVerilatorDiagnostics(diagnostics: VerilatorDiagnostic[]): VerilatorDiagnosticCounts {
  return diagnostics.reduce(
    (counts, diagnostic) => {
      if (diagnostic.severity === 'error') counts.errors += 1
      if (diagnostic.severity === 'warning') counts.warnings += 1
      return counts
    },
    { errors: 0, warnings: 0 },
  )
}

export function diagnosticMatchesPath(diagnosticPath: string, sourcePath: string): boolean {
  const diagnostic = normalizePath(diagnosticPath)
  const source = normalizePath(sourcePath)
  if (!diagnostic || !source) return false
  return diagnostic === source || fileName(diagnostic) === fileName(source)
}

export function fileName(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).pop() || path
}

function normalizePath(path: string): string {
  return String(path || '').replace(/\\/g, '/')
}
