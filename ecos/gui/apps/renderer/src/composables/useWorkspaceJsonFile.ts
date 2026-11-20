import { computed, onScopeDispose, ref, watch } from 'vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'

export function useWorkspaceJsonFile<T>(
  path: string,
  parse: (value: unknown) => T | null,
  invalidMessage: string,
  stepId?: string,
) {
  const { currentProject } = useWorkspace()
  const session = useBackendWorkspaceSession()
  const data = ref<T | null>(null)
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
    const flow = session.projection.data?.flow
    const directory =
      flow?.status === 'ready' || flow?.status === 'partial'
        ? flow.data.steps.find((step) => step.name === stepId)?.directory
        : undefined
    if (!projectPath || (stepId && !directory)) {
      data.value = null
      loading.value = false
      error.value = null
      return
    }

    loading.value = true
    error.value = null
    try {
      const text = await readOptionalProjectTextFile(
        stepId ? `${directory}/${path}` : path,
        { projectPath },
      )
      if (version !== requestVersion) return
      if (!text) {
        data.value = null
        return
      }
      const parsed = parse(JSON.parse(text) as unknown)
      data.value = parsed
      if (!parsed) error.value = invalidMessage
    } catch (cause) {
      if (version !== requestVersion) return
      data.value = null
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

  return { data, loading, error, refresh: load }
}
