import { beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopApiEventChannels, desktopMenuEventIds } from '@ecos-studio/shared'

const {
  buildFromTemplate,
  getAllWindows,
  getApplicationMenu,
  getFocusedWindow,
  setApplicationMenu,
} = vi.hoisted(() => ({
  buildFromTemplate: vi.fn(),
  getAllWindows: vi.fn(),
  getApplicationMenu: vi.fn(),
  getFocusedWindow: vi.fn(),
  setApplicationMenu: vi.fn(),
}))

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
    getApplicationMenu,
    setApplicationMenu,
  },
}))

import {
  applyWindowMenuState,
  registerApplicationMenu,
  setMenuActionEnabled,
} from './menuService'

type MenuItem = {
  accelerator?: string
  click?: () => void
  enabled?: boolean
  id?: string
  label?: string
  submenu?: MenuItem[]
}

describe('menuService', () => {
  beforeEach(() => {
    buildFromTemplate.mockReset()
    getAllWindows.mockReset()
    getApplicationMenu.mockReset()
    getFocusedWindow.mockReset()
    setApplicationMenu.mockReset()
  })

  it('registers a native menu that forwards supported actions to the renderer bridge', () => {
    const send = vi.fn()
    const onNewWindow = vi.fn()
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

    registerApplicationMenu({ onNewWindow })

    const fileMenu = capturedTemplate.find((item) => item.label === 'File')
    const helpMenu = capturedTemplate.find((item) => item.label === 'Help')
    const newWindow = fileMenu?.submenu?.find((item) => item.label === 'New Window')
    const newWorkspace = fileMenu?.submenu?.find((item) => item.label === 'New Workspace')
    const reconfigureWorkspace = fileMenu?.submenu?.find(
      (item) => item.label === 'Reconfigure Workspace...',
    )
    const exportSignoffPackage = fileMenu?.submenu?.find(
      (item) => item.label === 'Export Signoff Package...',
    )
    const exportDesignSummary = fileMenu?.submenu?.find(
      (item) => item.label === 'Export Design Summary...',
    )
    const documentation = helpMenu?.submenu?.find(
      (item) => item.label === 'Documentation',
    )
    const about = helpMenu?.submenu?.find((item) => item.label === 'About')

    expect(setApplicationMenu).toHaveBeenCalledTimes(1)
    expect(newWindow).toMatchObject({
      id: desktopMenuEventIds.newWindow,
    })
    expect(newWindow?.accelerator).toBeUndefined()
    expect(newWorkspace?.accelerator).toBeUndefined()
    expect(reconfigureWorkspace).toMatchObject({
      enabled: false,
      id: desktopMenuEventIds.reconfigureWorkspace,
    })
    expect(fileMenu?.submenu?.indexOf(exportSignoffPackage as MenuItem)).toBe(
      (fileMenu?.submenu?.indexOf(reconfigureWorkspace as MenuItem) ?? -2) + 1,
    )
    expect(exportSignoffPackage).toMatchObject({
      enabled: false,
      id: desktopMenuEventIds.exportSignoffPackage,
    })
    expect(exportDesignSummary).toMatchObject({
      enabled: false,
      id: desktopMenuEventIds.exportDesignSummary,
    })
    const designMenu = capturedTemplate.find((item) => item.label === 'Design')
    const manageRtl = designMenu?.submenu?.find(
      (item) => item.label === 'Manage RTL Files...',
    )
    expect(manageRtl).toMatchObject({
      enabled: false,
      id: desktopMenuEventIds.manageDesignFiles,
    })
    expect(documentation).toBeDefined()
    expect(about).toBeDefined()

    for (const menu of capturedTemplate) {
      for (const item of menu.submenu ?? []) {
        if (item.click) {
          expect(item.id).toBeTypeOf('string')
        }
      }
    }

    newWindow?.click?.()
    newWorkspace?.click?.()
    reconfigureWorkspace?.click?.()
    exportSignoffPackage?.click?.()
    exportDesignSummary?.click?.()
    documentation?.click?.()
    about?.click?.()

    expect(onNewWindow).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenNthCalledWith(
      1,
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.newProject,
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.reconfigureWorkspace,
    )
    expect(send).toHaveBeenNthCalledWith(
      3,
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.exportSignoffPackage,
    )
    expect(send).toHaveBeenNthCalledWith(
      4,
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.exportDesignSummary,
    )
    expect(send).toHaveBeenNthCalledWith(
      5,
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.documentation,
    )
    expect(send).toHaveBeenNthCalledWith(
      6,
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.about,
    )
  })

  it('updates a registered action by stable menu item ID', () => {
    const menuItem = { enabled: false }
    const getMenuItemById = vi.fn(() => menuItem)
    getApplicationMenu.mockReturnValue({ getMenuItemById })

    setMenuActionEnabled(desktopMenuEventIds.exportSignoffPackage, true)

    expect(getMenuItemById).toHaveBeenCalledWith(desktopMenuEventIds.exportSignoffPackage)
    expect(menuItem.enabled).toBe(true)
  })

  it('applies per-window menu state only for the focused window', () => {
    const exportItem = { enabled: false }
    const reconfigureItem = { enabled: false }
    const manageItem = { enabled: false }
    getApplicationMenu.mockReturnValue({
      getMenuItemById: vi.fn((id: string) => {
        if (id === desktopMenuEventIds.exportSignoffPackage) return exportItem
        if (id === desktopMenuEventIds.reconfigureWorkspace) return reconfigureItem
        if (id === desktopMenuEventIds.manageDesignFiles) return manageItem
        return undefined
      }),
    })
    getFocusedWindow.mockReturnValue({ webContents: { id: 2 } })
    getAllWindows.mockReturnValue([
      { webContents: { id: 1 } },
      { webContents: { id: 2 } },
    ])

    setMenuActionEnabled(desktopMenuEventIds.exportSignoffPackage, false, 1)
    expect(exportItem.enabled).toBe(false)

    setMenuActionEnabled(desktopMenuEventIds.exportSignoffPackage, true, 2)
    setMenuActionEnabled(desktopMenuEventIds.reconfigureWorkspace, true, 2)
    setMenuActionEnabled(desktopMenuEventIds.manageDesignFiles, true, 2)
    expect(exportItem.enabled).toBe(true)
    expect(reconfigureItem.enabled).toBe(true)
    expect(manageItem.enabled).toBe(true)

    getFocusedWindow.mockReturnValue({ webContents: { id: 1 } })
    applyWindowMenuState(1)
    expect(exportItem.enabled).toBe(false)
    expect(reconfigureItem.enabled).toBe(false)
    expect(manageItem.enabled).toBe(false)
  })

  it('safely ignores enabled-state updates when the menu or action is absent', () => {
    getApplicationMenu.mockReturnValueOnce(null)

    expect(() =>
      setMenuActionEnabled(desktopMenuEventIds.exportSignoffPackage, true),
    ).not.toThrow()

    getApplicationMenu.mockReturnValueOnce({
      getMenuItemById: vi.fn(() => undefined),
    })

    expect(() =>
      setMenuActionEnabled(desktopMenuEventIds.exportSignoffPackage, true),
    ).not.toThrow()
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
    const openWorkspace = fileMenu?.submenu?.find(
      (item) => item.label === 'Open Workspace',
    )

    openWorkspace?.click?.()

    expect(send).toHaveBeenCalledWith(
      desktopApiEventChannels.menuAction,
      desktopMenuEventIds.openProject,
    )
  })
})
