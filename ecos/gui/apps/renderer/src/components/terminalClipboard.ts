interface ClipboardApi {
  readText(): Promise<string>
  writeText(value: string): Promise<void>
}

function getClipboard(): ClipboardApi | undefined {
  return typeof navigator !== 'undefined' ? navigator.clipboard : undefined
}

export async function copyTerminalSelection(selection: string): Promise<void> {
  if (!selection) return

  const clipboard = getClipboard()
  if (!clipboard) return

  await clipboard.writeText(selection)
}

export async function readTerminalClipboard(): Promise<string> {
  const clipboard = getClipboard()
  if (!clipboard) return ''

  return clipboard.readText()
}
