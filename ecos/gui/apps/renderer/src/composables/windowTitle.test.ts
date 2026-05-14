import { beforeEach, describe, expect, it, vi } from 'vitest'

const { hasDesktopApi, waitForDesktopApi } = vi.hoisted(() => ({
  hasDesktopApi: vi.fn(),
  waitForDesktopApi: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  hasDesktopApi,
  waitForDesktopApi,
}))

import { setDesktopWindowTitle } from './windowTitle'

describe('setDesktopWindowTitle', () => {
  beforeEach(() => {
    hasDesktopApi.mockReset()
    waitForDesktopApi.mockReset()
  })

  it('updates the title through the desktop bridge when available', async () => {
    const setTitle = vi.fn().mockResolvedValue(undefined)

    hasDesktopApi.mockReturnValue(true)
    waitForDesktopApi.mockResolvedValue({
      window: {
        setTitle,
      },
    })

    await setDesktopWindowTitle('Project A')

    expect(setTitle).toHaveBeenCalledWith('Project A')
  })

  it('does nothing when the desktop bridge is unavailable', async () => {
    hasDesktopApi.mockReturnValue(false)

    await expect(setDesktopWindowTitle('Project B')).resolves.toBeUndefined()
    expect(waitForDesktopApi).not.toHaveBeenCalled()
  })
})
