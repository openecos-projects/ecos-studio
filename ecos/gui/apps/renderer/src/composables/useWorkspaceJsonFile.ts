import { computed, onScopeDispose, ref, watch } from 'vue'
import {
  eccFlowStepKey,
  normalizeLocalPath,
  type WorkspaceResourceIndex,
} from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import { useWorkspace } from '@/composables/useWorkspace'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'

const inFlightIndexes = new Map<string, Promise<WorkspaceResourceIndex>>()

export async function workspaceStepFeaturePath(
  workspace: string,
  stepId: string,
): Promise<string | undefined> {
  let pending = inFlightIndexes.get(workspace)
  if (!pending) {
    pending = getWorkspaceResourceIndexApi().finally(() =>
      inFlightIndexes.delete(workspace),
    )
    inFlightIndexes.set(workspace, pending)
  }
  const index = await pending
  if (normalizeLocalPath(index.root) !== normalizeLocalPath(workspace)) return
  if (index.status === 'error') throw new Error(index.messages.join('\n'))
  const feature = index.flow.steps.find(
    (step) => eccFlowStepKey(step.name) === eccFlowStepKey(stepId),
  )?.resources.feature.step
  return feature?.exists ? feature.path : undefined
}

export function useWorkspaceJsonFile<T>(
  path: string | ((workspace: string) => Promise<string | undefined>),
  parse: (value: unknown) => T | null,
  invalidMessage: string,
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
    if (!projectPath) {
      data.value = null
      loading.value = false
      error.value = null
      return
    }

    loading.value = true
    error.value = null
    try {
      const resolvedPath = typeof path === 'function' ? await path(projectPath) : path
      if (version !== requestVersion) return
      const text = resolvedPath
        ? await readOptionalProjectTextFile(resolvedPath, { projectPath })
        : null
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
