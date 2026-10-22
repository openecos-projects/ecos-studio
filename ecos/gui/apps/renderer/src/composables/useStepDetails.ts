import { computed, onScopeDispose, ref, watch } from 'vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import {
  ANTENNA_STEP_PATH,
  LVS_STEP_PATH,
  parseStepDetails,
  type StepDetailsModel,
} from '@/components/flow-insights/stepDetails'

function useStepDetails(path: string, invalidMessage: string) {
  const { currentProject } = useWorkspace()
  const session = useBackendWorkspaceSession()
  const summary = ref<StepDetailsModel | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let requestVersion = 0

  const revision = computed(() => {
    const value = session.projection.data?.revision
    return value?.status === 'ready' || value?.status === 'partial'
      ? value.data.workspaceRevision
      : null
  })

  async function load(): Promise<void> {
    const projectPath = currentProject.value?.path
    const version = ++requestVersion
    if (!projectPath) {
      summary.value = null
      loading.value = false
      error.value = null
      return
    }

    loading.value = true
    error.value = null
    try {
      const text = await readOptionalProjectTextFile(path, { projectPath })
      if (version !== requestVersion) return
      if (!text) {
        summary.value = null
        return
      }
      const parsed = JSON.parse(text) as unknown
      summary.value = parseStepDetails(parsed)
      if (!summary.value) error.value = invalidMessage
    } catch (cause) {
      if (version !== requestVersion) return
      summary.value = null
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  watch([() => currentProject.value?.path ?? '', revision], () => void load(), {
    immediate: true,
  })
  onScopeDispose(() => {
    requestVersion += 1
  })

  return { summary, loading, error, refresh: load }
}

export function useLvsSummary() {
  return useStepDetails(LVS_STEP_PATH, 'LVS analysis result is invalid.')
}

export function useAntennaSummary() {
  return useStepDetails(ANTENNA_STEP_PATH, 'Antenna check result is invalid.')
}
