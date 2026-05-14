import { beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopApiEventChannels, desktopMenuEventIds } from '@ecos-studio/shared'

const { buildFromTemplate, getAllWindows, getFocusedWindow, setApplicationMenu } = vi.hoisted(
  () => ({
    buildFromTemplate: vi.fn(),
    getAllWindows: vi.fn(),
    getFocusedWindow: vi.fn(),
    setApplicationMenu: vi.fn(),
  }),
)

vi.mock('electron', () => ({
  app: {
    name: 'ECOS Studio',
  },
  BrowserWindow: {
    getAllWindows,
    getFocusedWindow,
  },
  Menu: {
    buildFromTemplate,
    setApplicationMenu,
  },
}))

import { registerApplicationMenu } from './menuService'

type MenuItem = {
  accelerator?: string
  click?: () => void
  label?: string
  submenu?: MenuItem[]
}

describe('menuService', () => {
  beforeEach(() => {
    buildFromTemplate.mockReset()
    getAllWindows.mockReset()
    getFocusedWindow.mockReset()
    setApplicationMenu.mockReset()
  })

  it('registers a native menu that forwards supported actions to the renderer bridge', () => {
    const send = vi.fn()
    let capturedTemplate: MenuItem[] = []

    getFocusedWindow.mockReturnValue({
      webContents: {
        send,
      },
    })
    buildFromTemplate.mockImplementation((template: MenuItem[]) => {
      capturedTemplate = template
      return { items: template }
    })

    registerApplicationMenu()

    const fileMenu = capturedTemplate.find((item) => item.label === 'File')
    const helpMenu = capturedTemplate.find((item) => item.label === 'Help')
    const newWorkspace = fileMenu?.submenu?.find((item) => item.label === 'New Workspace')
    const documentation = helpMenu?.submenu?.find((item) => item.label === 'Documentation')
    const about = helpMenu?.submenu?.find((item) => item.label === 'About')

    expect(setApplicationMenu).toHaveBeenCalledTimes(1)
    expect(newWorkspace?.accelerator).toBe('CmdOrCtrl+N')
    expect(documentation).toBeDefined()
    expect(about).toBeDefined()

    newWorkspace?.click?.()
    documentation?.click?.()
    about?.click?.()

    expect(send).toHaveBeenNthCalledWith(
      1,
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.newProject,
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.documentation,
    )
    expect(send).toHaveBeenNthCalledWith(
      3,
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.about,
    )
  })

  it('falls back to the first open window when no window is focused', () => {
    const send = vi.fn()
    let capturedTemplate: MenuItem[] = []

    getFocusedWindow.mockReturnValue(null)
    getAllWindows.mockReturnValue([
      {
        webContents: {
          send,
        },
      },
    ])
    buildFromTemplate.mockImplementation((template: MenuItem[]) => {
      capturedTemplate = template
      return { items: template }
    })

    registerApplicationMenu()

    const fileMenu = capturedTemplate.find((item) => item.label === 'File')
    const openWorkspace = fileMenu?.submenu?.find((item) => item.label === 'Open Workspace')

    openWorkspace?.click?.()

    expect(send).toHaveBeenCalledWith(
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.openProject,
    )
  })
})
