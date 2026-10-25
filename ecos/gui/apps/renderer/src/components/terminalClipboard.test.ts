// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTerminalSelection, readTerminalClipboard } from './terminalClipboard'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function setClipboard(clipboard: Clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  })
}

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
  }
  vi.restoreAllMocks()
})

describe('terminal clipboard helpers', () => {
  it('copies non-empty terminal selections', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText, readText: vi.fn() } as unknown as Clipboard)

    await copyTerminalSelection('selected output')

    expect(writeText).toHaveBeenCalledWith('selected output')
  })

  it('does not write an empty selection', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText, readText: vi.fn() } as unknown as Clipboard)

    await copyTerminalSelection('')

    expect(writeText).not.toHaveBeenCalled()
  })

  it('reads clipboard text for terminal paste', async () => {
    const readText = vi.fn().mockResolvedValue('command from clipboard')
    setClipboard({ writeText: vi.fn(), readText } as unknown as Clipboard)

    await expect(readTerminalClipboard()).resolves.toBe('command from clipboard')
    expect(readText).toHaveBeenCalledTimes(1)
  })

  it('returns an empty string when the clipboard API is unavailable', async () => {
    setClipboard(undefined as unknown as Clipboard)

    await expect(readTerminalClipboard()).resolves.toBe('')
    await expect(copyTerminalSelection('selected output')).resolves.toBeUndefined()
  })
})
