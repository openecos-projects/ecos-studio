import {
  BrowserWindow,
  Menu,
  app,
  type BrowserWindow as ElectronBrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron'
import {
  appMenuActionIds,
  desktopApiEventChannels,
  type DesktopMenuEventId,
} from '@ecos-studio/shared'

type MenuTargetWindow = Pick<ElectronBrowserWindow, 'webContents'>

function getMenuTargetWindow(): MenuTargetWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function emitMenuAction(eventId: DesktopMenuEventId): void {
  getMenuTargetWindow()?.webContents.send(desktopApiEventChannels.menuAction, eventId)
}

function createMenuAction(
  label: string,
  eventId: DesktopMenuEventId,
  accelerator?: string,
  enabled?: boolean,
): MenuItemConstructorOptions {
  return {
    accelerator,
    click: () => {
      emitMenuAction(eventId)
    },
    enabled,
    id: eventId,
    label,
  }
}

export function setMenuActionEnabled(action: DesktopMenuEventId, enabled: boolean): void {
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById(action)
  if (menuItem) {
    menuItem.enabled = enabled
  }
}

export function registerApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = []

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  template.push(
    {
      label: 'File',
      submenu: [
        createMenuAction('New Workspace', appMenuActionIds.newProject, 'CmdOrCtrl+N'),
        createMenuAction('Open Workspace', appMenuActionIds.openProject, 'CmdOrCtrl+O'),
        createMenuAction(
          'Reconfigure Workspace...',
          appMenuActionIds.reconfigureWorkspace,
        ),
        createMenuAction(
          'Export Signoff Package...',
          appMenuActionIds.exportSignoffPackage,
          undefined,
          false,
        ),
      ],
    },
    {
      label: 'Design',
      submenu: [
        createMenuAction('Manage RTL Files...', appMenuActionIds.manageDesignFiles),
      ],
    },
    {
      label: 'Help',
      submenu: [
        createMenuAction('Documentation', appMenuActionIds.documentation),
        { type: 'separator' },
        createMenuAction('About', appMenuActionIds.about),
      ],
    },
  )

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
