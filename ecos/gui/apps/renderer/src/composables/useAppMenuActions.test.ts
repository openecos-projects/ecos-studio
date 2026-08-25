import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appMenuActionIds, type AppMenuAction } from '@ecos-studio/shared'

const { useMenuEvents } = vi.hoisted(() => ({
  useMenuEvents: vi.fn(),
}))

vi.mock('./useMenuEvents', () => ({
  useMenuEvents,
}))

import { useAppMenuActions } from './useAppMenuActions'

describe('useAppMenuActions', () => {
  beforeEach(() => {
    useMenuEvents.mockReset()
  })

  it('registers app-level native menu handlers that dispatch the real app actions', async () => {
    let registeredHandlers: Partial<Record<AppMenuAction, () => void>> | undefined

    useMenuEvents.mockImplementation((handlers) => {
      registeredHandlers = handlers
    })

    const showNewProjectWizard = vi.fn()
    const createWindow = vi.fn().mockResolvedValue(undefined)
    const openProject = vi.fn().mockResolvedValue(true)
    const openDocumentation = vi.fn().mockResolvedValue(undefined)
    const navigateToWorkspace = vi.fn()
    const showAboutDialog = vi.fn()
    const reconfigureWorkspace = vi.fn()
    const exportSignoffPackage = vi.fn()
    const exportDesignMetrics = vi.fn()

    const { handleMenuAction } = useAppMenuActions({
      createWindow,
      navigateToWorkspace,
      openDocumentation,
      openProject,
      reconfigureWorkspace,
      exportSignoffPackage,
      exportDesignMetrics,
      showAboutDialog,
      showNewProjectWizard,
    })

    expect(useMenuEvents).toHaveBeenCalledTimes(1)
    expect(registeredHandlers).toBeDefined()

    registeredHandlers?.[appMenuActionIds.newWindow]?.()
    await Promise.resolve()

    expect(createWindow).toHaveBeenCalledTimes(1)

    registeredHandlers?.[appMenuActionIds.newProject]?.()
    await Promise.resolve()

    expect(showNewProjectWizard).toHaveBeenCalledTimes(1)

    registeredHandlers?.[appMenuActionIds.openProject]?.()
    await Promise.resolve()

    expect(openProject).toHaveBeenCalledTimes(1)
    expect(navigateToWorkspace).toHaveBeenCalledTimes(1)

    registeredHandlers?.[appMenuActionIds.reconfigureWorkspace]?.()
    await Promise.resolve()

    expect(reconfigureWorkspace).toHaveBeenCalledTimes(1)

    registeredHandlers?.[appMenuActionIds.exportSignoffPackage]?.()
    await Promise.resolve()

    expect(exportSignoffPackage).toHaveBeenCalledTimes(1)

    registeredHandlers?.[appMenuActionIds.exportDesignMetrics]?.()
    await Promise.resolve()

    expect(exportDesignMetrics).toHaveBeenCalledTimes(1)

    registeredHandlers?.[appMenuActionIds.documentation]?.()
    await Promise.resolve()

    expect(openDocumentation).toHaveBeenCalledTimes(1)

    registeredHandlers?.[appMenuActionIds.about]?.()
    await Promise.resolve()

    expect(showAboutDialog).toHaveBeenCalledTimes(1)

    await handleMenuAction(appMenuActionIds.about)

    expect(showAboutDialog).toHaveBeenCalledTimes(2)

    await handleMenuAction(appMenuActionIds.openProject)

    expect(openProject).toHaveBeenCalledTimes(2)
    expect(navigateToWorkspace).toHaveBeenCalledTimes(2)

    await handleMenuAction(appMenuActionIds.reconfigureWorkspace)

    expect(reconfigureWorkspace).toHaveBeenCalledTimes(2)

    await handleMenuAction(appMenuActionIds.exportSignoffPackage)

    expect(exportSignoffPackage).toHaveBeenCalledTimes(2)

    await handleMenuAction(appMenuActionIds.exportDesignMetrics)

    expect(exportDesignMetrics).toHaveBeenCalledTimes(2)
  })

  it('does not navigate when opening a project is cancelled', async () => {
    useMenuEvents.mockImplementation(() => undefined)

    const navigateToWorkspace = vi.fn()
    const { handleMenuAction } = useAppMenuActions({
      navigateToWorkspace,
      openDocumentation: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(false),
      showAboutDialog: vi.fn(),
      showNewProjectWizard: vi.fn(),
    })

    await handleMenuAction(appMenuActionIds.openProject)

    expect(navigateToWorkspace).not.toHaveBeenCalled()
  })

  it('dispatches all View zoom actions to the shared zoom handler', async () => {
    let registeredHandlers: Partial<Record<string, () => void>> | undefined
    useMenuEvents.mockImplementation((handlers) => {
      registeredHandlers = handlers
    })
    const adjustZoom = vi.fn().mockResolvedValue(undefined)
    const { handleMenuAction } = useAppMenuActions({
      adjustZoom,
      navigateToWorkspace: vi.fn(),
      openDocumentation: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(false),
      showAboutDialog: vi.fn(),
      showNewProjectWizard: vi.fn(),
    })

    for (const action of [
      appMenuActionIds.zoomIn,
      appMenuActionIds.zoomOut,
      appMenuActionIds.zoomReset,
    ]) {
      registeredHandlers?.[action]?.()
      await handleMenuAction(action)
    }

    expect(adjustZoom).toHaveBeenNthCalledWith(1, appMenuActionIds.zoomIn)
    expect(adjustZoom).toHaveBeenNthCalledWith(2, appMenuActionIds.zoomIn)
    expect(adjustZoom).toHaveBeenNthCalledWith(3, appMenuActionIds.zoomOut)
    expect(adjustZoom).toHaveBeenNthCalledWith(4, appMenuActionIds.zoomOut)
    expect(adjustZoom).toHaveBeenNthCalledWith(5, appMenuActionIds.zoomReset)
    expect(adjustZoom).toHaveBeenNthCalledWith(6, appMenuActionIds.zoomReset)
  })
})
