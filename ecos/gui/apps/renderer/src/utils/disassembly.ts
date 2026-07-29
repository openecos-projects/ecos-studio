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
