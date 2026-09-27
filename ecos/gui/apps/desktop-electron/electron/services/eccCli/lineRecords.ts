const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const MAX_RECORDS = 20_000
const MAX_LINE_BYTES = 64 * 1024
const KEY = /^[a-z][a-z0-9_]*$/

export type EccLineRecord = Record<string, string>

export function parseEccLineRecords(input: string): EccLineRecord[] {
  if (Buffer.byteLength(input, 'utf8') > MAX_OUTPUT_BYTES) {
    throw new Error('ECC catalog exceeds the output limit.')
  }
  const lines = input.endsWith('\n') ? input.slice(0, -1).split('\n') : input.split('\n')
  if (lines.length === 1 && lines[0] === '') return []
  if (lines.length > MAX_RECORDS) throw new Error('ECC catalog has too many records.')
  return lines.map((line) => parseLine(line))
}

function parseLine(line: string): EccLineRecord {
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    throw new Error('ECC catalog record exceeds the line limit.')
  }
  const result: EccLineRecord = {}
  let offset = 0
  while (offset < line.length) {
    const keyStart = offset
    while (offset < line.length && line[offset] !== '=') offset += 1
    if (offset === line.length) throw new Error('ECC catalog record has no value.')
    const key = line.slice(keyStart, offset)
    if (!KEY.test(key) || Object.hasOwn(result, key)) {
      throw new Error('ECC catalog record has an invalid or duplicate key.')
    }
    offset += 1
    let value = ''
    if (line[offset] === '"') {
      ;[value, offset] = readQuoted(line, offset + 1)
    } else {
      const valueStart = offset
      while (offset < line.length && line[offset] !== ' ') offset += 1
      value = line.slice(valueStart, offset)
      if (!value || !/^[A-Za-z0-9._:/+@-]+$/.test(value)) {
        throw new Error('ECC catalog record has an invalid unquoted value.')
      }
    }
    result[key] = value
    if (offset === line.length) break
    if (line[offset] !== ' ') throw new Error('ECC catalog fields are not separated.')
    offset += 1
    if (offset === line.length || line[offset] === ' ') {
      throw new Error('ECC catalog record has invalid whitespace.')
    }
  }
  if (Object.keys(result)[0] !== 'record') {
    throw new Error('ECC catalog record discriminator must be first.')
  }
  return result
}

function readQuoted(line: string, start: number): [string, number] {
  let value = ''
  let offset = start
  while (offset < line.length) {
    const character = line[offset++]!
    if (character === '"') return [value, offset]
    if (character !== '\\') {
      if (character < ' ')
        throw new Error('ECC catalog has an unescaped control character.')
      value += character
      continue
    }
    const escaped = line[offset++]
    if (escaped === undefined) throw new Error('ECC catalog has an incomplete escape.')
    const replacement = { '\\': '\\', '"': '"', n: '\n', r: '\r', t: '\t' }[escaped]
    if (replacement === undefined) throw new Error('ECC catalog has an invalid escape.')
    value += replacement
  }
  throw new Error('ECC catalog has an unterminated quoted value.')
}

export function parseJsonLiteral(value: string): unknown {
  const parsed = JSON.parse(value)
  if (!finiteJson(parsed)) throw new Error('ECC catalog has a non-finite JSON literal.')
  return parsed
}

function finiteJson(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(finiteJson)
  if (value && typeof value === 'object') return Object.values(value).every(finiteJson)
  return true
}
