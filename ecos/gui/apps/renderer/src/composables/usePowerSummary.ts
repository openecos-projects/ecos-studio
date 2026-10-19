import { computed, onScopeDispose, ref, watch } from 'vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import {
  parsePowerSummaryStep,
  POWER_SUMMARY_STEP_PATH,
  type PowerSummaryModel,
} from '@/components/flow-insights/powerSummary'

export function usePowerSummary() {
  const { currentProject } = useWorkspace()
  const session = useBackendWorkspaceSession()
  const summary = ref<PowerSummaryModel | null>(null)
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
      const text = await readOptionalProjectTextFile(POWER_SUMMARY_STEP_PATH, {
        projectPath,
      })
      if (version !== requestVersion) return
      if (!text) {
        summary.value = null
        return
      }
      const parsed = JSON.parse(text) as unknown
      summary.value = parsePowerSummaryStep(parsed)
      if (!summary.value) error.value = 'Power analysis result is invalid.'
    } catch (cause) {
      if (version !== requestVersion) return
      summary.value = null
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  watch(
    [() => currentProject.value?.path ?? '', revision],
    () => void load(),
    { immediate: true },
  )
  onScopeDispose(() => {
    requestVersion += 1
  })

  return { summary, loading, error, refresh: load }
}
