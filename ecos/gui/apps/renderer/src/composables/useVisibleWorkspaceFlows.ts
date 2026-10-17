import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  ProjectWorkspaceFlows,
  ProjectWorkspaceFlowsRequest,
} from '@ecos-studio/shared'
import { getOptionalDesktopApi } from '@/platform/desktop'

export function useVisibleWorkspaceFlows(targets: () => ProjectWorkspaceFlowsRequest) {
  const flows = ref<ProjectWorkspaceFlows>({})
  let sequence = 0
  let disposed = false
  let unsubscribe: (() => void) | undefined

  async function reload() {
    const request = targets()
    const current = ++sequence
    try {
      const api = getOptionalDesktopApi()?.projectManagement
      if (!api?.watchWorkspaceFlows) return
      const result = await api.watchWorkspaceFlows(request)
      if (!disposed && current === sequence) flows.value = result
    } catch {
      if (disposed || current !== sequence) return
      flows.value = Object.fromEntries(
        request.projects.map((project) => [
          project.projectRoot,
          Object.fromEntries(
            project.workspaceIds.map((id) => [
              id,
              { steps: {}, running: false, issue: 'unavailable' as const },
            ]),
          ),
        ]),
      )
    }
  }

  watch(
    () => JSON.stringify(targets()),
    () => {
      void reload()
    },
    { immediate: true },
  )
  onMounted(() => {
    unsubscribe = getOptionalDesktopApi()?.projectManagement?.onWorkspaceFlowsChanged?.(
      () => {
        void reload()
      },
    )
  })
  onBeforeUnmount(() => {
    disposed = true
    sequence += 1
    unsubscribe?.()
    void getOptionalDesktopApi()
      ?.projectManagement?.watchWorkspaceFlows?.({ projects: [] })
      .catch(() => undefined)
  })
  return flows
}
