import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  extractDesignReportData,
  generateDesignReport,
  joinLocalPath,
  type DesignReportFormat,
  type EccWorkspaceInspectSignoffResult,
  type SignoffAdditionalFile,
} from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

interface SignoffProject {
  path?: string
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
  showToast(options: ToastOptions): void
  workspaceSession: Readonly<Ref<SignoffWorkspaceSession>>
}

interface SignoffPackageReviewState {
  error: string
  loading: boolean
  result: EccWorkspaceInspectSignoffResult | null
  visible: boolean
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

function projectPathForWorkspace(workspacePath: string): string {
  const normalized = workspacePath.replace(/[\\/]+$/g, '')
  const separatorIndex = Math.max(
    normalized.lastIndexOf('/'),
    normalized.lastIndexOf('\\'),
  )

  if (separatorIndex <= 0) return normalized
  return normalized.slice(0, separatorIndex)
}

function signoffPackageDefaultPath(workspacePath: string, design: string): string {
  return joinLocalPath(
    joinLocalPath(projectPathForWorkspace(workspacePath), 'signoff'),
    `${design}_signoff_package.tar.gz`,
  )
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useSignoffPackageExport({
  currentProject,
  showToast,
  workspaceSession,
}: SignoffPackageExportDependencies) {
  const signoffPackageReview = ref<SignoffPackageReviewState>({
    error: '',
    loading: false,
    result: null,
    visible: false,
  })
  const canConfirmSignoffPackageExport = computed(() => {
    const review = signoffPackageReview.value
    return (
      review.visible &&
      !review.loading &&
      !review.error &&
      review.result?.status !== 'blocked'
    )
  })
  let reviewGeneration = 0
  let reviewWorkspacePath = ''
  let reviewWorkspaceHandle = ''

  watch(
    () => [currentProject.value?.path, workspaceSession.value.workspaceId],
    () => {
      if (
        signoffPackageReview.value.visible &&
        (currentProject.value?.path !== reviewWorkspacePath ||
          workspaceSession.value.workspaceId !== reviewWorkspaceHandle)
      ) {
        closeSignoffPackageReview()
      }
    },
  )

  onUnmounted(() => {
    closeSignoffPackageReview()
  })

  function activeWorkspaceSnapshot() {
    const workspacePath = currentProject.value?.path
    const workspaceHandle =
      workspaceSession.value.state === 'active' ? workspaceSession.value.workspaceId : ''
    if (!workspacePath || !workspaceHandle) return null
    return { workspaceHandle, workspacePath }
  }

  function isActiveWorkspace(workspacePath: string, workspaceHandle: string): boolean {
    return (
      currentProject.value?.path === workspacePath &&
      workspaceSession.value.state === 'active' &&
      workspaceSession.value.workspaceId === workspaceHandle
    )
  }

  function closeSignoffPackageReview(): void {
    reviewGeneration += 1
    reviewWorkspacePath = ''
    reviewWorkspaceHandle = ''
    signoffPackageReview.value = {
      error: '',
      loading: false,
      result: null,
      visible: false,
    }
  }

  async function refreshSignoffPackageReview(): Promise<void> {
    const workspace = activeWorkspaceSnapshot()
    if (!workspace) {
      closeSignoffPackageReview()
      return
    }

    const generation = ++reviewGeneration
    reviewWorkspacePath = workspace.workspacePath
    reviewWorkspaceHandle = workspace.workspaceHandle
    signoffPackageReview.value = {
      error: '',
      loading: true,
      result: null,
      visible: true,
    }

    try {
      const result = await getDesktopApi().ecc.workspace.inspectSignoff({
        workspaceHandle: workspace.workspaceHandle,
      })
      if (
        generation !== reviewGeneration ||
        !isActiveWorkspace(workspace.workspacePath, workspace.workspaceHandle)
      ) {
        return
      }
      signoffPackageReview.value = {
        error: '',
        loading: false,
        result,
        visible: true,
      }
    } catch (error) {
      if (
        generation !== reviewGeneration ||
        !isActiveWorkspace(workspace.workspacePath, workspace.workspaceHandle)
      ) {
        return
      }
      signoffPackageReview.value = {
        error: errorDetail(error) || 'Signoff inspection failed.',
        loading: false,
        result: null,
        visible: true,
      }
    }
  }

  async function exportSignoffPackage(): Promise<void> {
    const workspace = activeWorkspaceSnapshot()
    if (!workspace) {
      showToast({
        severity: 'warn',
        summary: 'Signoff Package Not Available',
        detail: 'Open an eligible workspace before exporting a signoff package.',
      })
      return
    }

    await refreshSignoffPackageReview()
  }

  async function confirmSignoffPackageExport(): Promise<void> {
    if (!canConfirmSignoffPackageExport.value) return

    const workspace = activeWorkspaceSnapshot()
    if (
      !workspace ||
      workspace.workspacePath !== reviewWorkspacePath ||
      workspace.workspaceHandle !== reviewWorkspaceHandle
    ) {
      closeSignoffPackageReview()
      return
    }

    closeSignoffPackageReview()
    try {
      const api = getDesktopApi()
      const parameters = await api.workspaceResources.readParameters()
      if (!isActiveWorkspace(workspace.workspacePath, workspace.workspaceHandle)) return

      const design =
        isRecord(parameters) &&
        typeof parameters.Design === 'string' &&
        parameters.Design.trim()
          ? parameters.Design.trim()
          : workspaceLeaf(workspace.workspacePath)
      const outputPath = await api.dialog.saveFile({
        title: 'Export Signoff Package',
        defaultPath: signoffPackageDefaultPath(workspace.workspacePath, design),
        ensureDirectory: true,
        filters: [{ name: 'Signoff Package', extensions: ['tar.gz'] }],
      })
      if (
        !outputPath ||
        !isActiveWorkspace(workspace.workspacePath, workspace.workspaceHandle)
      ) {
        return
      }

      const flow = await api.workspaceResources.readFlow().catch(() => null)
      const home = await api.workspaceResources.readHome().catch(() => null)
      const versions = await api.app
        .getVersions()
        .catch(() => ({ gui: '', ecc: '', eccTools: '' }))
      const reportData = extractDesignReportData({
        workspacePath: workspace.workspacePath,
        parameters: isRecord(parameters) ? parameters : undefined,
        flow,
        homeData: isRecord(home) ? home : undefined,
        versionInfo: isRecord(versions)
          ? {
              gui: typeof versions.gui === 'string' ? versions.gui : undefined,
              ecc: typeof versions.ecc === 'string' ? versions.ecc : undefined,
              eccTools:
                typeof versions.eccTools === 'string' ? versions.eccTools : undefined,
            }
          : undefined,
      })

      const reportFormats: DesignReportFormat[] = [
        'latex',
        'markdown',
        'typst',
        'csv',
        'text',
      ]
      const formatExtMap: Record<DesignReportFormat, string> = {
        latex: 'tex',
        markdown: 'md',
        typst: 'typ',
        csv: 'csv',
        text: 'txt',
      }
      const additionalFiles: SignoffAdditionalFile[] = reportFormats.map((fmt) => {
        const ext = formatExtMap[fmt]
        const content = generateDesignReport(reportData, fmt, {
          includeMultiCorner: true,
          includeStageBreakdown: true,
          includeVerificationBreakdown: true,
          latexStandalone: true,
          typstStandalone: true,
        })
        return {
          archivePath: `design_summaries/${design}_design_summary.${ext}`,
          content,
        }
      })

      const result = await api.ecc.workspace.exportSignoff({
        additionalFiles,
        outputPath,
        workspaceHandle: workspace.workspaceHandle,
      })
      if (!isActiveWorkspace(workspace.workspacePath, workspace.workspaceHandle)) return

      showToast({
        severity: 'success',
        summary: 'Signoff Package Exported',
        detail: `Saved package and design summaries to ${result.outputPath}`,
      })
    } catch (error) {
      if (!isActiveWorkspace(workspace.workspacePath, workspace.workspaceHandle)) return
      showToast({
        severity: 'error',
        summary: 'Failed to Export Signoff Package',
        detail: errorDetail(error) || 'Export failed.',
      })
    }
  }

  return {
    canConfirmSignoffPackageExport,
    closeSignoffPackageReview,
    confirmSignoffPackageExport,
    exportSignoffPackage,
    refreshSignoffPackageReview,
    signoffPackageReview,
  }
}
