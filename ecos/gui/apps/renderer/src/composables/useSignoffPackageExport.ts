import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  extractDesignReportData,
  generateDesignReport,
  joinLocalPath,
  validateEngineeringSnapshot,
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
  workspaceRevision?: number
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

function workspaceLeaf(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * Prefer the configured design name from either vocabulary: legacy JSON
 * uses `Design`, TOML-flattened parameters use `design`.
 */
function signoffPackageDesignName(parameters: unknown, workspacePath: string): string {
  if (!isRecord(parameters)) return workspaceLeaf(workspacePath)
  return (
    firstNonEmptyString(parameters.Design, parameters.design) ||
    workspaceLeaf(workspacePath)
  )
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
  let reviewWorkspaceRevision: number | undefined

  watch(
    () => [
      currentProject.value?.path,
      workspaceSession.value.workspaceId,
      workspaceSession.value.workspaceRevision,
    ],
    () => {
      if (
        signoffPackageReview.value.visible &&
        (currentProject.value?.path !== reviewWorkspacePath ||
          workspaceSession.value.workspaceId !== reviewWorkspaceHandle ||
          (reviewWorkspaceRevision !== undefined &&
            workspaceSession.value.workspaceRevision !== undefined &&
            workspaceSession.value.workspaceRevision !== reviewWorkspaceRevision))
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
    return {
      workspaceHandle,
      workspacePath,
      workspaceRevision: workspaceSession.value.workspaceRevision,
    }
  }

  function isActiveWorkspace(
    workspacePath: string,
    workspaceHandle: string,
    workspaceRevision?: number,
  ): boolean {
    return (
      currentProject.value?.path === workspacePath &&
      workspaceSession.value.state === 'active' &&
      workspaceSession.value.workspaceId === workspaceHandle &&
      (workspaceRevision === undefined ||
        workspaceSession.value.workspaceRevision === undefined ||
        workspaceSession.value.workspaceRevision === workspaceRevision)
    )
  }

  function closeSignoffPackageReview(): void {
    reviewGeneration += 1
    reviewWorkspacePath = ''
    reviewWorkspaceHandle = ''
    reviewWorkspaceRevision = undefined
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
    const expectedRevision = workspace.workspaceRevision ?? reviewWorkspaceRevision
    reviewWorkspacePath = workspace.workspacePath
    reviewWorkspaceHandle = workspace.workspaceHandle
    reviewWorkspaceRevision = expectedRevision
    signoffPackageReview.value = {
      error: '',
      loading: true,
      result: null,
      visible: true,
    }

    try {
      const runtime = getDesktopApi().ecc.runtime
      if (!runtime) throw new Error('ECC Engineering Snapshot API is unavailable.')
      const result = await runtime.engineeringSnapshot({
        workspaceHandle: workspace.workspaceHandle,
        ...(expectedRevision !== undefined
          ? { expectedWorkspaceRevision: expectedRevision }
          : {}),
      })
      if (
        generation !== reviewGeneration ||
        !isActiveWorkspace(
          workspace.workspacePath,
          workspace.workspaceHandle,
          result.workspaceRevision,
        )
      ) {
        return
      }
      const validated = validateEngineeringSnapshot(result, result.workspaceId)
      if (!validated.ok) throw new Error(validated.issue.code)
      if (validated.sections.signoff.status !== 'ready') {
        throw new Error(
          validated.sections.signoff.issues[0]?.code ?? 'ENGINEERING_SIGNOFF_INVALID',
        )
      }
      reviewWorkspaceRevision = result.workspaceRevision
      signoffPackageReview.value = {
        error: '',
        loading: false,
        result: validated.sections.signoff.data,
        visible: true,
      }
    } catch (error) {
      if (
        generation !== reviewGeneration ||
        !isActiveWorkspace(
          workspace.workspacePath,
          workspace.workspaceHandle,
          expectedRevision,
        )
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
      workspace.workspaceHandle !== reviewWorkspaceHandle ||
      !isActiveWorkspace(
        workspace.workspacePath,
        workspace.workspaceHandle,
        reviewWorkspaceRevision,
      )
    ) {
      closeSignoffPackageReview()
      return
    }

    closeSignoffPackageReview()
    try {
      const api = getDesktopApi()
      const runtime = api.ecc.runtime
      if (!runtime) throw new Error('ECC runtime snapshot API is unavailable.')
      const runtimeSnapshot = await runtime.snapshot({
        workspaceHandle: workspace.workspaceHandle,
      })
      const parameters = runtimeSnapshot.parameters
      if (
        !isActiveWorkspace(
          workspace.workspacePath,
          workspace.workspaceHandle,
          workspace.workspaceRevision,
        )
      )
        return

      const design = signoffPackageDesignName(parameters, workspace.workspacePath)
      const outputPath = await api.dialog.saveFile({
        title: 'Export Signoff Package',
        defaultPath: signoffPackageDefaultPath(workspace.workspacePath, design),
        ensureDirectory: true,
        filters: [{ name: 'Signoff Package', extensions: ['tar.gz'] }],
      })
      if (
        !outputPath ||
        !isActiveWorkspace(
          workspace.workspacePath,
          workspace.workspaceHandle,
          workspace.workspaceRevision,
        )
      ) {
        return
      }

      const flow = runtimeSnapshot.flow
      const home = runtimeSnapshot.home
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

      const result = await api.productCommands.execute({
        command: 'workspace.exportSignoff',
        payload: {
          additionalFiles,
          outputPath,
          workspaceHandle: workspace.workspaceHandle,
        },
      })
      if (
        !isActiveWorkspace(
          workspace.workspacePath,
          workspace.workspaceHandle,
          workspace.workspaceRevision,
        )
      )
        return

      showToast({
        severity: 'success',
        summary: 'Signoff Package Exported',
        detail: `Saved package and design summaries to ${'outputPath' in result ? result.outputPath : outputPath}`,
      })
    } catch (error) {
      if (
        !isActiveWorkspace(
          workspace.workspacePath,
          workspace.workspaceHandle,
          workspace.workspaceRevision,
        )
      )
        return
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
