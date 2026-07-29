export function normalizeDisassemblyAddress(
  value: string | number | null | undefined,
): string {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^0x/, '')

  if (!text || !/^[0-9a-f]+$/.test(text)) return ''
  return text.replace(/^0+(?=[0-9a-f])/, '')
}

export function findDisassemblyAddressLine(
  content: string,
  address: string | number | null | undefined,
): number | null {
  const target = normalizeDisassemblyAddress(address)
  if (!target) return null

  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*([0-9a-fA-F]+):(?:\s|$)/)
    if (match && normalizeDisassemblyAddress(match[1]) === target) {
      return index + 1
    }
  }
  return null
}

const SOURCE_LOCATION_PATTERN = /:\d+(?:\s+\(discriminator\s+\d+\))?\s*$/
const FILE_FORMAT_PATTERN = /:\s+file format\s+\S+\s*$/
const SECTION_PATTERN = /^\s*Disassembly of section\s+.+:\s*$/
const SYMBOL_PATTERN = /^\s*[0-9a-fA-F]+\s+<[^>]+>:\s*$/
const INSTRUCTION_PATTERN = /^\s*[0-9a-fA-F]+:\s+[0-9a-fA-F]+(?:\s|$)/

export function stripSourceFromDisassembly(content: string): string {
  const lines = content.split(/\r?\n/)
  if (!lines.some((line) => SOURCE_LOCATION_PATTERN.test(line))) return content

  const result: string[] = []
  let pendingBlank = false

  for (const line of lines) {
    if (!line.trim()) {
      pendingBlank = result.length > 0
      continue
    }

    const isDisassemblyLine =
      FILE_FORMAT_PATTERN.test(line) ||
      SECTION_PATTERN.test(line) ||
      SYMBOL_PATTERN.test(line) ||
      INSTRUCTION_PATTERN.test(line)
    if (!isDisassemblyLine) continue

    if (pendingBlank && result.length > 0) result.push('')
    result.push(line)
    pendingBlank = false
  }

  return result.length > 0 ? `${result.join('\n')}\n` : content
}
