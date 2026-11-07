import { getDesktopApi } from '@/platform/desktop'

export interface DefViewLaunchDeps {
  workspacePath: string
  workspaceHandle: string
  showToast(toast: {
    severity: 'error' | 'warn' | 'info'
    summary: string
    detail?: string
    life?: number
  }): void
}

/**
 * Generate a layout snapshot from a DEF in the active Workspace, then open it
 * in the native Chip Viewer. The Workspace's existing PDK and parameters are
 * reused by the ECC runtime.
 */
export async function launchDefView(
  defPath: string,
  deps: DefViewLaunchDeps,
): Promise<void> {
  const api = getDesktopApi()
  try {
    await api.productCommands.execute({
      command: 'workspace.defView',
      payload: {
        defPath,
        workspaceHandle: deps.workspaceHandle,
      },
    })
    await api.chipViewer.open({
      projectPath: deps.workspacePath,
      step: 'defview',
      mode: 'view',
    })
  } catch (error) {
    deps.showToast({
      severity: 'error',
      summary: 'DEF View Error',
      detail: error instanceof Error ? error.message : String(error),
      life: 15000,
    })
  }
}
