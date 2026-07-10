import { onUnmounted, watch, type Ref } from 'vue'
import { appMenuActionIds } from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

interface SignoffProject {
  path?: string
}

interface SignoffResourceVersions {
  flow: number
  all: number
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
}: SignoffPackageExportDependencies) {
  let syncGeneration = 0
  let unmounted = false

  async function setMenuEnabled(enabled: boolean): Promise<void> {
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
    await setMenuEnabled(false)

    if (!workspacePath || unmounted || generation !== syncGeneration) return

    try {
      const flow = await getDesktopApi().workspaceResources.readFlow()
      if (
        unmounted ||
        generation !== syncGeneration ||
        currentProject.value?.path !== workspacePath
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

  watch(
    () => [
      currentProject.value?.path,
      resourceVersions.value.flow,
      resourceVersions.value.all,
    ],
    () => {
      void syncMenuEligibility()
    },
    { immediate: true },
  )

  onUnmounted(() => {
    unmounted = true
    syncGeneration += 1
    void setMenuEnabled(false)
  })

  async function exportSignoffPackage(): Promise<void> {
    const workspacePath = currentProject.value?.path
    if (!workspacePath) {
      await setMenuEnabled(false)
      showToast({
        severity: 'warn',
        summary: 'Signoff Package Not Available',
        detail: 'Open an eligible workspace before exporting a signoff package.',
      })
      return
    }

    const isActiveWorkspace = () => currentProject.value?.path === workspacePath

    try {
      const api = getDesktopApi()
      const flow = await api.workspaceResources.readFlow()
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

      const result = await api.cli.execute({
        cmd: 'export_signoff_package',
        data: {
          directory: workspacePath,
          output_path: outputPath,
        },
        source: 'menu',
      })

      if (!result.ok) {
        showToast({
          severity: 'error',
          summary: 'Failed to Export Signoff Package',
          detail:
            result.message.length > 0 ? result.message.join('\n') : 'Export failed.',
        })
        return
      }

      showToast({
        severity: 'success',
        summary: 'Signoff Package Exported',
        detail: `Saved to ${outputPath}`,
      })
    } catch (error) {
      showToast({
        severity: 'error',
        summary: 'Failed to Export Signoff Package',
        detail: errorDetail(error),
      })
    }
  }

  return { exportSignoffPackage }
}
