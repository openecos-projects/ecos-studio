import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDesktopApi } = vi.hoisted(() => ({
  getDesktopApi: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi,
}))

import { setDesktopWindowTitle } from './windowTitle'

describe('setDesktopWindowTitle', () => {
  beforeEach(() => {
    getDesktopApi.mockReset()
  })

  it('updates the title through the desktop bridge when available', async () => {
    const setTitle = vi.fn().mockResolvedValue(undefined)

    getDesktopApi.mockReturnValue({
      window: {
        setTitle,
      },
    })

    await setDesktopWindowTitle('Project A')

    expect(setTitle).toHaveBeenCalledWith('Project A')
  })

  it('fails immediately when the desktop bridge is unavailable', async () => {
    getDesktopApi.mockImplementation(() => {
      throw new Error('ECOS desktop bridge is not available.')
    })

    await expect(setDesktopWindowTitle('Project B')).rejects.toThrow(
      'ECOS desktop bridge is not available.',
    )
  })
})
