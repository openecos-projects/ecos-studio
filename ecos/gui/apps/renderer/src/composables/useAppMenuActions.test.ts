import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appMenuActionIds } from '@ecos-studio/shared'

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
    let registeredHandlers:
      | Partial<
          Record<
            | typeof appMenuActionIds.documentation
            | typeof appMenuActionIds.newProject
            | typeof appMenuActionIds.openProject
            | typeof appMenuActionIds.about,
            () => void
          >
        >
      | undefined

    useMenuEvents.mockImplementation((handlers) => {
      registeredHandlers = handlers
    })

    const showNewProjectWizard = vi.fn()
    const openProject = vi.fn().mockResolvedValue(true)
    const openDocumentation = vi.fn().mockResolvedValue(undefined)
    const navigateToWorkspace = vi.fn()
    const showAboutDialog = vi.fn()

    const { handleMenuAction } = useAppMenuActions({
      navigateToWorkspace,
      openDocumentation,
      openProject,
      showAboutDialog,
      showNewProjectWizard,
    })

    expect(useMenuEvents).toHaveBeenCalledTimes(1)
    expect(registeredHandlers).toBeDefined()

    registeredHandlers?.[appMenuActionIds.newProject]?.()
    await Promise.resolve()

    expect(showNewProjectWizard).toHaveBeenCalledTimes(1)

    registeredHandlers?.[appMenuActionIds.openProject]?.()
    await Promise.resolve()

    expect(openProject).toHaveBeenCalledTimes(1)
    expect(navigateToWorkspace).toHaveBeenCalledTimes(1)

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
})
