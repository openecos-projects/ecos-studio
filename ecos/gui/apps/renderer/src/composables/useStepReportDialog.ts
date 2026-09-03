import { ref, watch, type Ref } from 'vue'
import { getDesktopApi } from '@/platform/desktop'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import type { StepDashboardReport } from './stepDashboardSnapshot'

export function useStepReportDialog(
  currentStep: Readonly<Ref<string>>,
  loadedStep: Readonly<Ref<string | undefined>>,
) {
  const session = useBackendWorkspaceSession()
  const reportDialog = ref({
    label: '',
    content: '',
    error: '',
    loading: false,
    visible: false,
  })
  let requestVersion = 0

  watch(loadedStep, () => {
    requestVersion += 1
    reportDialog.value.visible = false
  })

  async function openReport(report: StepDashboardReport): Promise<void> {
    const version = ++requestVersion
    const contextId = session.workspaceContextId
    const step = currentStep.value
    reportDialog.value = {
      label: report.label,
      content: '',
      error: '',
      loading: true,
      visible: true,
    }
    try {
      const revision = session.projection.data?.revision
      if (
        !contextId ||
        !revision ||
        (revision.status !== 'ready' && revision.status !== 'partial')
      ) {
        throw new Error('Committed Workspace revision is unavailable.')
      }
      const result = await getDesktopApi().backendWorkspace.getArtifact({
        artifactId: report.artifactId,
        workspaceContextId: contextId,
        workspaceRevision: revision.data.workspaceRevision,
      })
      const currentRevision = session.projection.data?.revision
      if (
        version !== requestVersion ||
        currentStep.value !== step ||
        session.workspaceContextId !== contextId ||
        !currentRevision ||
        (currentRevision.status !== 'ready' && currentRevision.status !== 'partial') ||
        currentRevision.data.workspaceRevision !== revision.data.workspaceRevision ||
        result.workspaceContextId !== contextId ||
        result.workspaceRevision !== revision.data.workspaceRevision
      ) {
        return
      }
      if (result.artifact.status !== 'ready' || result.artifact.data.text === undefined) {
        throw new Error(result.artifact.issues[0]?.code ?? 'Report is unavailable.')
      }
      reportDialog.value.content = result.artifact.data.text
    } catch (cause) {
      if (version !== requestVersion) return
      reportDialog.value.error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (version === requestVersion) reportDialog.value.loading = false
    }
  }

  return { openReport, reportDialog }
}
