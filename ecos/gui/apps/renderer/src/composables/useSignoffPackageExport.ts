import { onUnmounted, ref, watch, type Ref } from 'vue'
import { appMenuActionIds } from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'
import { resolveProjectFilePath, watchProjectFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'

interface SignoffProject {
  path?: string
}

interface SignoffResourceVersions {
  flow: number
  all: number
}

interface SignoffWorkspaceSession {
  state: string
  workspaceId: string
}

interface ToastOptions {
  severity?: 'success' | 'info' | 'warn' | 'error' | 'secondary' | 'contrast'
  summary: string
  detail?: string
  life?: number
}

interface SignoffPackageExportDependencies {
  currentProject: Readonly<Ref<SignoffProject | null | undefined>>
  resourceVersions: Readonly<Ref<SignoffResourceVersions>>
  showToast(options: ToastOptions): void
  workspaceSession: Readonly<Ref<SignoffWorkspaceSession>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function canExportSignoffPackage(flow: unknown): boolean {
  if (!isRecord(flow) || !Array.isArray(flow.steps) || flow.steps.length === 0) {
    return false
  }

  const finalStep = flow.steps[flow.steps.length - 1]
  return (
    isRecord(finalStep) &&
    typeof finalStep.name === 'string' &&
    finalStep.name.trim().toLowerCase() === 'harden' &&
    finalStep.state === 'Success'
  )
}

function workspaceLeaf(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useSignoffPackageExport({
  currentProject,
  resourceVersions,
  showToast,
  workspaceSession,
}: SignoffPackageExportDependencies) {
  const signoffPackageExportEnabled = ref(false)
  let syncGeneration = 0
  let watcherGeneration = 0
  let unwatchFlowFile: (() => void) | null = null
  let unmounted = false

  async function setMenuEnabled(enabled: boolean): Promise<void> {
    signoffPackageExportEnabled.value = enabled
    try {
      await getDesktopApi().menu.setActionEnabled(
        appMenuActionIds.exportSignoffPackage,
        enabled,
      )
    } catch (error) {
      console.warn('[signoff-export] Failed to update native menu state:', error)
    }
  }

  async function syncMenuEligibility(): Promise<void> {
    const generation = ++syncGeneration
    const workspacePath = currentProject.value?.path
    const workspaceHandle =
      workspaceSession.value.state === 'active' ? workspaceSession.value.workspaceId : ''
    await setMenuEnabled(false)

    if (
      !workspacePath ||
      !workspaceHandle ||
      unmounted ||
      generation !== syncGeneration
    ) {
      return
    }

    try {
      const flow = await getDesktopApi().workspaceResources.readFlow()
      if (
        unmounted ||
        generation !== syncGeneration ||
        currentProject.value?.path !== workspacePath ||
        workspaceSession.value.workspaceId !== workspaceHandle
      ) {
        return
      }
      await setMenuEnabled(canExportSignoffPackage(flow))
    } catch {
      if (
        !unmounted &&
        generation === syncGeneration &&
        currentProject.value?.path === workspacePath
      ) {
        await setMenuEnabled(false)
      }
    }
  }

  function cleanupFlowWatcher(): void {
    watcherGeneration += 1
    unwatchFlowFile?.()
    unwatchFlowFile = null
  }

  async function startFlowWatcher(): Promise<void> {
    cleanupFlowWatcher()
    const generation = watcherGeneration
    const workspacePath = currentProject.value?.path
    if (!workspacePath || unmounted) return

    try {
      const flowPath = resolveProjectFilePath('home/flow.json', workspacePath)
      const resolvedFlowPath = await resolveProjectPathAccess(flowPath)
      if (
        !resolvedFlowPath ||
        unmounted ||
        generation !== watcherGeneration ||
        currentProject.value?.path !== workspacePath
      ) {
        return
      }

      const unwatch = await watchProjectFile(resolvedFlowPath, () => {
        if (
          unmounted ||
          generation !== watcherGeneration ||
          currentProject.value?.path !== workspacePath
        ) {
          return
        }
        void syncMenuEligibility()
      })
      if (
        unmounted ||
        generation !== watcherGeneration ||
        currentProject.value?.path !== workspacePath
      ) {
        unwatch?.()
        return
      }
      unwatchFlowFile = unwatch
    } catch (error) {
      if (
        !unmounted &&
        generation === watcherGeneration &&
        currentProject.value?.path === workspacePath
      ) {
        console.warn('[signoff-export] Failed to watch home/flow.json:', error)
      }
    }
  }

  watch(
    () => [
      currentProject.value?.path,
      resourceVersions.value.flow,
      resourceVersions.value.all,
      workspaceSession.value.state,
      workspaceSession.value.workspaceId,
    ],
    () => {
      void syncMenuEligibility()
    },
    { immediate: true },
  )

  watch(
    () => currentProject.value?.path,
    () => {
      void startFlowWatcher()
    },
    { immediate: true },
  )

  onUnmounted(() => {
    unmounted = true
    syncGeneration += 1
    cleanupFlowWatcher()
    void setMenuEnabled(false)
  })

  async function exportSignoffPackage(): Promise<void> {
    const workspacePath = currentProject.value?.path
    const workspaceHandle =
      workspaceSession.value.state === 'active' ? workspaceSession.value.workspaceId : ''
    if (!workspacePath || !workspaceHandle) {
      await setMenuEnabled(false)
      showToast({
        severity: 'warn',
        summary: 'Signoff Package Not Available',
        detail: 'Open an eligible workspace before exporting a signoff package.',
      })
      return
    }

    const isActiveWorkspace = () =>
      currentProject.value?.path === workspacePath &&
      workspaceSession.value.state === 'active' &&
      workspaceSession.value.workspaceId === workspaceHandle
    let flowReadCompleted = false

    try {
      const api = getDesktopApi()
      const flow = await api.workspaceResources.readFlow()
      flowReadCompleted = true
      if (!isActiveWorkspace()) return

      if (!canExportSignoffPackage(flow)) {
        await setMenuEnabled(false)
        showToast({
          severity: 'warn',
          summary: 'Signoff Package Not Available',
          detail: 'Complete the final Harden step successfully before exporting.',
        })
        return
      }

      const parameters = await api.workspaceResources.readParameters()
      if (!isActiveWorkspace()) return

      const design =
        isRecord(parameters) &&
        typeof parameters.Design === 'string' &&
        parameters.Design.trim()
          ? parameters.Design.trim()
          : workspaceLeaf(workspacePath)

      const outputPath = await api.dialog.saveFile({
        title: 'Export Signoff Package',
        defaultPath: `${design}_signoff_package.tar.gz`,
        filters: [{ name: 'Signoff Package', extensions: ['tar.gz'] }],
      })
      if (!outputPath || !isActiveWorkspace()) return

      const result = await api.ecc.workspace.exportSignoff({
        outputPath,
        workspaceHandle,
      })
      if (!isActiveWorkspace()) return

      showToast({
        severity: 'success',
        summary: 'Signoff Package Exported',
        detail: `Saved to ${result.outputPath}`,
      })
    } catch (error) {
      if (!isActiveWorkspace()) return
      if (!flowReadCompleted) await setMenuEnabled(false)
      showToast({
        severity: 'error',
        summary: 'Failed to Export Signoff Package',
        detail: errorDetail(error) || 'Export failed.',
      })
    }
  }

  return { exportSignoffPackage, signoffPackageExportEnabled }
}
