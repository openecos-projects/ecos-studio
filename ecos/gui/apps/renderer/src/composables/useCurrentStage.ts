import { computed } from 'vue'
import { useRoute } from 'vue-router'

export interface WorkspaceStageFlags {
  isHome: boolean
  isConfigure: boolean
  isTech: boolean
  isFlowStep: boolean
}

export function getWorkspaceStageFlags(stage: string): WorkspaceStageFlags {
  const isHome = stage === 'home'
  const isConfigure = stage === 'configure'
  const isTech = stage === 'tech'
  const isWorkspaceTool = isConfigure || isTech

  return {
    isHome,
    isConfigure,
    isTech,
    isFlowStep: !isHome && !isWorkspaceTool,
  }
}

/**
 * Resolves the workspace stage represented by the active route.
 */
export function useCurrentStage() {
  const route = useRoute()

  const currentStage = computed(() => {
    const pathParts = route.path.split('/')
    return pathParts[pathParts.length - 1] || 'home'
  })

  const isHome = computed(() => getWorkspaceStageFlags(currentStage.value).isHome)
  const isConfigure = computed(
    () => getWorkspaceStageFlags(currentStage.value).isConfigure,
  )
  const isTech = computed(() => getWorkspaceStageFlags(currentStage.value).isTech)
  const isFlowStep = computed(() => getWorkspaceStageFlags(currentStage.value).isFlowStep)

  function getStagePath(stagePath: string): string {
    return `/workspace/${stagePath}`
  }

  function isCurrentStage(stagePath: string): boolean {
    return currentStage.value === stagePath
  }

  return {
    currentStage,
    isHome,
    isConfigure,
    isTech,
    isFlowStep,
    getStagePath,
    isCurrentStage,
  }
}
