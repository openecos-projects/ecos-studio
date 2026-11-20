import { ref } from 'vue'
import { toDesktopBridgeData } from '@/api/desktopPayload'
import { getDesktopApi } from '@/platform/desktop'
import type {
  DesignTool,
  WorkspaceCreationModel,
  WorkspaceCreationModelRequest,
} from '@ecos-studio/shared'

export function useWorkspaceCreationModel(options: {
  designTool: () => DesignTool | undefined
  flowId: () => string
  inputMode: () => 'rtl' | 'postSynthesis'
  mpc: () => Record<string, unknown> | null
  pdk: () => {
    familyId: string
    mode: 'default' | 'manual'
    version?: string | null
  } | null
  projectPresetParameters: () => Record<string, unknown>
}) {
  const model = ref<WorkspaceCreationModel | null>(null)
  const isLoading = ref(false)
  const loadError = ref('')
  let generation = 0

  async function refresh(): Promise<void> {
    if (options.designTool() === 'frontend') return
    const requestGeneration = ++generation
    isLoading.value = true
    loadError.value = ''
    try {
      const request: WorkspaceCreationModelRequest = {
        flowId: options.flowId(),
        inputMode: options.inputMode(),
        mpc: options.mpc(),
        pdk: options.pdk(),
        projectPresetParameters: options.projectPresetParameters(),
      }
      const next = await getDesktopApi().workspaceCreationModel.get(
        toDesktopBridgeData(
          request as unknown as Record<string, unknown>,
        ) as WorkspaceCreationModelRequest,
      )
      if (requestGeneration !== generation) return
      model.value = next
    } catch (error) {
      if (requestGeneration !== generation) return
      console.warn(
        'Failed to load the ECC workspace creation model; flow steps and the parameter catalog are unavailable.',
        error,
      )
      model.value = null
      loadError.value =
        error instanceof Error && error.message
          ? error.message
          : 'Could not load the ECC flow definition.'
    } finally {
      if (requestGeneration === generation) isLoading.value = false
    }
  }

  return { model, isLoading, loadError, refresh }
}
