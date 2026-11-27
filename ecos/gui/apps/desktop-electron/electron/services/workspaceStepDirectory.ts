export function isWorkspaceStepDirectory(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    value !== '.' &&
    !value.endsWith('.') &&
    !/[\\/:]/u.test(value) &&
    !Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
}
