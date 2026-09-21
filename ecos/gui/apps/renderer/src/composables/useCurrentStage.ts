import { computed } from 'vue'
import { useRoute } from 'vue-router'

export interface WorkspaceStageFlags {
  isHome: boolean
  isTech: boolean
  isFlowStep: boolean
}

export function getWorkspaceStageFlags(stage: string): WorkspaceStageFlags {
  const isHome = stage === 'home'
  const isTech = stage === 'tech'

  return {
    isHome,
    isTech,
    isFlowStep: !isHome && !isTech,
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
    isTech,
    isFlowStep,
    getStagePath,
    isCurrentStage,
  }
}
