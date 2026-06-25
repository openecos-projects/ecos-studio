export function colorNumberToCss(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`
}
