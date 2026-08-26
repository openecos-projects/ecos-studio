import { appMenuActionIds, type AppMenuAction } from '@ecos-studio/shared'
import { useMenuEvents } from './useMenuEvents'

interface AppMenuActionDependencies {
  createWindow?(): Promise<void> | void
  navigateToWorkspace(): void
  openDocumentation(): Promise<void>
  openProject(): Promise<boolean | undefined>
  exportSignoffPackage?(): void | Promise<void>
  exportDesignSummary?(): void | Promise<void>
  exportDesignMetrics?(): void | Promise<void>
  reconfigureWorkspace?(): void | Promise<void>
  showAboutDialog(): void
  showNewProjectWizard(): void
  manageDesignFiles?(): void | Promise<void>
  adjustZoom?(action: AppMenuAction): void | Promise<void>
}

export function useAppMenuActions({
  createWindow,
  navigateToWorkspace,
  openDocumentation,
  openProject,
  exportSignoffPackage,
  exportDesignSummary,
  exportDesignMetrics,
  reconfigureWorkspace,
  showAboutDialog,
  showNewProjectWizard,
  manageDesignFiles,
  adjustZoom,
}: AppMenuActionDependencies) {
  const handleMenuAction = async (action: AppMenuAction) => {
    switch (action) {
      case appMenuActionIds.newWindow:
        await createWindow?.()
        break
      case appMenuActionIds.newProject:
        showNewProjectWizard()
        break
      case appMenuActionIds.openProject:
        if (await openProject()) {
          navigateToWorkspace()
        }
        break
      case appMenuActionIds.manageDesignFiles:
        await manageDesignFiles?.()
        break
      case appMenuActionIds.reconfigureWorkspace:
        await reconfigureWorkspace?.()
        break
      case appMenuActionIds.exportSignoffPackage:
        await exportSignoffPackage?.()
        break
      case appMenuActionIds.exportDesignSummary:
      case appMenuActionIds.exportDesignMetrics:
        await (exportDesignSummary || exportDesignMetrics)?.()
        break
      case appMenuActionIds.documentation:
        await openDocumentation()
        break
      case appMenuActionIds.about:
        showAboutDialog()
        break
      case appMenuActionIds.zoomIn:
      case appMenuActionIds.zoomOut:
      case appMenuActionIds.zoomReset:
        await adjustZoom?.(action)
        break
      default:
        break
    }
  }

  useMenuEvents({
    [appMenuActionIds.documentation]: () => {
      void handleMenuAction(appMenuActionIds.documentation)
    },
    [appMenuActionIds.newWindow]: () => {
      void handleMenuAction(appMenuActionIds.newWindow)
    },
    [appMenuActionIds.newProject]: () => {
      void handleMenuAction(appMenuActionIds.newProject)
    },
    [appMenuActionIds.openProject]: () => {
      void handleMenuAction(appMenuActionIds.openProject)
    },
    [appMenuActionIds.about]: () => {
      void handleMenuAction(appMenuActionIds.about)
    },
    [appMenuActionIds.manageDesignFiles]: () => {
      void handleMenuAction(appMenuActionIds.manageDesignFiles)
    },
    [appMenuActionIds.reconfigureWorkspace]: () => {
      void handleMenuAction(appMenuActionIds.reconfigureWorkspace)
    },
    [appMenuActionIds.exportSignoffPackage]: () => {
      void handleMenuAction(appMenuActionIds.exportSignoffPackage)
    },
    [appMenuActionIds.exportDesignSummary]: () => {
      void handleMenuAction(appMenuActionIds.exportDesignSummary)
    },
    [appMenuActionIds.zoomIn]: () => void handleMenuAction(appMenuActionIds.zoomIn),
    [appMenuActionIds.zoomOut]: () => void handleMenuAction(appMenuActionIds.zoomOut),
    [appMenuActionIds.zoomReset]: () => void handleMenuAction(appMenuActionIds.zoomReset),
  })

  return {
    handleMenuAction,
  }
}
