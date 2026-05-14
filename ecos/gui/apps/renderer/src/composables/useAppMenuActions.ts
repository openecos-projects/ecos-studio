import { appMenuActionIds, type AppMenuAction } from '@ecos-studio/shared'
import { useMenuEvents } from './useMenuEvents'

interface AppMenuActionDependencies {
  navigateToWorkspace(): void
  openDocumentation(): Promise<void>
  openProject(): Promise<boolean | undefined>
  showAboutDialog(): void
  showNewProjectWizard(): void
}

export function useAppMenuActions({
  navigateToWorkspace,
  openDocumentation,
  openProject,
  showAboutDialog,
  showNewProjectWizard,
}: AppMenuActionDependencies) {
  const handleMenuAction = async (action: AppMenuAction) => {
    switch (action) {
      case appMenuActionIds.newProject:
        showNewProjectWizard()
        break
      case appMenuActionIds.openProject:
        if (await openProject()) {
          navigateToWorkspace()
        }
        break
      case appMenuActionIds.documentation:
        await openDocumentation()
        break
      case appMenuActionIds.about:
        showAboutDialog()
        break
      default:
        break
    }
  }

  useMenuEvents({
    [appMenuActionIds.documentation]: () => {
      void handleMenuAction(appMenuActionIds.documentation)
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
  })

  return {
    handleMenuAction,
  }
}
