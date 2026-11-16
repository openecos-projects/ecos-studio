/** Preserve omission and reject invalid IPC values before starting a CLI mutation. */
export function stepSubprocessArgs(value: unknown): string[] {
  if (value === undefined) return []
  if (typeof value !== 'boolean') {
    throw new Error('Workspace stepSubprocess must be a boolean.')
  }
  return [value ? '--step-subprocess' : '--no-step-subprocess']
}
