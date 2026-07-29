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

export interface ApplicationMenuOptions {
  onNewWindow?: () => void
}

/** Menu actions whose enabled state depends on the focused window's workspace. */
export const workspaceDependentMenuActions: DesktopMenuEventId[] = [
  appMenuActionIds.reconfigureWorkspace,
  appMenuActionIds.manageDesignFiles,
  appMenuActionIds.exportSignoffPackage,
]

const menuStateByWindowId = new Map<number, Map<DesktopMenuEventId, boolean>>()

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

function applyMenuItemEnabled(action: DesktopMenuEventId, enabled: boolean): void {
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById(action)
  if (menuItem) {
    menuItem.enabled = enabled
  }
}

function defaultEnabledForAction(action: DesktopMenuEventId): boolean {
  return !workspaceDependentMenuActions.includes(action)
}

/**
 * Apply the stored per-window menu enabled flags for `windowId` onto the
 * shared native menu. Workspace-dependent actions default to disabled.
 */
export function applyWindowMenuState(windowId: number): void {
  const state = menuStateByWindowId.get(windowId)
  for (const action of workspaceDependentMenuActions) {
    applyMenuItemEnabled(action, state?.get(action) ?? false)
  }
}

export function clearWindowMenuState(windowId: number): void {
  menuStateByWindowId.delete(windowId)
}

/**
 * Record a menu enabled flag for a specific window. Only mutates the live
 * native menu when that window is currently focused (or is the fallback target).
 */
export function setMenuActionEnabled(
  action: DesktopMenuEventId,
  enabled: boolean,
  windowId?: number,
): void {
  if (windowId !== undefined) {
    let state = menuStateByWindowId.get(windowId)
    if (!state) {
      state = new Map()
      menuStateByWindowId.set(windowId, state)
    }
    state.set(action, enabled)

    const focused = BrowserWindow.getFocusedWindow()
    const targetId =
      focused?.webContents.id ?? BrowserWindow.getAllWindows()[0]?.webContents.id
    if (targetId === windowId) {
      applyMenuItemEnabled(action, enabled)
    }
    return
  }

  applyMenuItemEnabled(action, enabled)
}

export function registerApplicationMenu(options: ApplicationMenuOptions = {}): void {
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
        {
          // Accelerators are handled in the renderer TopBar so frameless windows
          // get one consistent shortcut path without double-firing.
          click: () => {
            options.onNewWindow?.()
          },
          id: appMenuActionIds.newWindow,
          label: 'New Window',
        },
        createMenuAction('New Workspace', appMenuActionIds.newProject),
        createMenuAction('Open Workspace', appMenuActionIds.openProject),
        createMenuAction(
          'Reconfigure Workspace...',
          appMenuActionIds.reconfigureWorkspace,
          undefined,
          false,
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
        createMenuAction(
          'Manage RTL Files...',
          appMenuActionIds.manageDesignFiles,
          undefined,
          false,
        ),
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

  // Re-apply focused window state after rebuild (defaults are disabled).
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) {
    applyWindowMenuState(focused.webContents.id)
  } else {
    for (const action of workspaceDependentMenuActions) {
      applyMenuItemEnabled(action, defaultEnabledForAction(action))
    }
  }
}
