import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import {
  normalizeLocalPath,
  type WorkspaceResourceFile,
  type WorkspaceStepResource,
} from '@ecos-studio/shared'
import { sameFlowStepName } from '@/api/type'
import { getDesktopApi } from '@/platform/desktop'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import { useWorkspace } from './useWorkspace'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'

export interface StepReportFile {
  label: string
  path: string
}

const MAX_REPORT_FILES = 2048
const MAX_REPORT_BYTES = 256 * 1024

export function stepReportFiles(
  step: WorkspaceStepResource,
  root: string,
): StepReportFile[] {
  const workspacePrefix = `${normalizeLocalPath(root).replace(/\\/g, '/').replace(/\/$/, '')}/`
  const stepDirectory = normalizeLocalPath(step.directory)
    .replace(/\\/g, '/')
    .replace(/\/$/, '')
  if (!stepDirectory.startsWith(workspacePrefix))
    throw new Error('Report directory is outside the workspace.')
  const files = new Map<string, StepReportFile>()
  const addFile = (file: WorkspaceResourceFile) => {
    if (!file.exists) return
    const path = normalizeLocalPath(file.path).replace(/\\/g, '/')
    if (path === `${stepDirectory}/report` || path === `${stepDirectory}/reports`) return
    if (
      !path.startsWith(`${stepDirectory}/report/`) &&
      !path.startsWith(`${stepDirectory}/reports/`)
    ) {
      throw new Error('Report file is outside the step report directory.')
    }
    files.set(path, { label: path.slice(stepDirectory.length + 1), path: file.path })
  }
  for (const value of Object.values(step.resources.report)) {
    if (typeof value.path === 'string') addFile(value as WorkspaceResourceFile)
    else for (const file of Object.values(value)) addFile(file as WorkspaceResourceFile)
  }
  if (files.size > MAX_REPORT_FILES)
    throw new Error('Report listing limit reached. Narrow the report directory on disk.')
  return [...files.values()].sort((left, right) => left.label.localeCompare(right.label))
}

export function useStepReportsBrowser(stepId: Readonly<Ref<string>>) {
  const { currentProject } = useWorkspace()
  const session = useBackendWorkspaceSession()
  const files = ref<StepReportFile[]>([])
  const selectedPath = ref('')
  const content = ref('')
  const error = ref('')
  const contentError = ref('')
  const loading = ref(false)
  const contentLoading = ref(false)
  const truncated = ref(false)
  let listVersion = 0
  let readVersion = 0

  const scope = computed(() => {
    const revision = session.projection.data?.revision
    return JSON.stringify([
      currentProject.value?.path,
      session.workspaceContextId,
      session.generation,
      revision?.status === 'ready' || revision?.status === 'partial'
        ? revision.data.workspaceRevision
        : null,
      stepId.value,
    ])
  })

  async function selectReport(file: StepReportFile): Promise<void> {
    if (!files.value.some((candidate) => candidate.path === file.path)) return
    const version = ++readVersion
    const requestScope = scope.value
    selectedPath.value = file.path
    content.value = ''
    contentError.value = ''
    truncated.value = false
    contentLoading.value = true
    try {
      const read = getDesktopApi().workspace.readOptionalProjectTextFileChunk
      if (!read) throw new Error('Bounded report reading is unavailable.')
      const result = await read.call(
        getDesktopApi().workspace,
        file.path,
        0,
        MAX_REPORT_BYTES,
      )
      if (version !== readVersion || scope.value !== requestScope) return
      if (!result) throw new Error('The report is missing.')
      if (result.content.includes('\u0000'))
        throw new Error('This report is not a text file.')
      content.value = result.content
      truncated.value = !result.eof
    } catch (cause) {
      if (version === readVersion && scope.value === requestScope) {
        contentError.value = cause instanceof Error ? cause.message : String(cause)
      }
    } finally {
      if (version === readVersion) contentLoading.value = false
    }
  }

  async function refresh(): Promise<void> {
    const version = ++listVersion
    ++readVersion
    const requestScope = scope.value
    files.value = []
    selectedPath.value = ''
    content.value = ''
    error.value = ''
    contentError.value = ''
    truncated.value = false
    contentLoading.value = false
    loading.value = true
    try {
      const root = currentProject.value?.path
      if (!root || !stepId.value) return
      const index = await getWorkspaceResourceIndexApi()
      if (version !== listVersion || scope.value !== requestScope) return
      if (normalizeLocalPath(index.root) !== normalizeLocalPath(root))
        throw new Error('Workspace changed while loading reports.')
      const step = index.flow.steps.find((candidate) =>
        sameFlowStepName(candidate.name, stepId.value),
      )
      if (!step) throw new Error('The step report directory is unavailable.')
      if (index.status === 'error')
        throw new Error(
          index.messages.join('\n') || 'Report resources could not be loaded.',
        )
      files.value = stepReportFiles(step, root)
      if (files.value[0]) await selectReport(files.value[0])
    } catch (cause) {
      if (version === listVersion && scope.value === requestScope) {
        error.value = cause instanceof Error ? cause.message : String(cause)
      }
    } finally {
      if (version === listVersion) loading.value = false
    }
  }

  watch(scope, () => void refresh(), { immediate: true })
  onScopeDispose(() => {
    ++listVersion
    ++readVersion
  })

  return {
    files,
    selectedPath,
    content,
    error,
    contentError,
    loading,
    contentLoading,
    truncated,
    refresh,
    selectReport,
  }
}
