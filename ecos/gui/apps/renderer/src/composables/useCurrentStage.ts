import { computed } from 'vue'
import { useRoute } from 'vue-router'

export interface WorkspaceStageFlags {
  showProgressPanel: boolean
  showOverviewPanel: boolean
  showSubflowPanel: boolean
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
    showProgressPanel: !isWorkspaceTool,
    showOverviewPanel: isHome,
    showSubflowPanel: !isWorkspaceTool && !isHome,
    isHome,
    isConfigure,
    isTech,
    isFlowStep: !isHome && !isWorkspaceTool,
  }
}

// ============ Composable ============

/**
 * 当前阶段管理 Hook
 * 负责解析和管理当前路由对应的流程阶段
 */
export function useCurrentStage() {
  const route = useRoute()

  /** 当前阶段路径 */
  const currentStage = computed(() => {
    const pathParts = route.path.split('/')
    return pathParts[pathParts.length - 1] || 'home'
  })

  /** 是否显示进度面板 (Configure 页面不显示) */
  const showProgressPanel = computed(() => {
    return getWorkspaceStageFlags(currentStage.value).showProgressPanel
  })

  /** 是否显示概览面板 (Home 页面显示概览) */
  const showOverviewPanel = computed(() => {
    return getWorkspaceStageFlags(currentStage.value).showOverviewPanel
  })

  /** 是否显示子流程面板 (非 Home 和非 Configure 页面显示) */
  const showSubflowPanel = computed(() => {
    return getWorkspaceStageFlags(currentStage.value).showSubflowPanel
  })

  /** 是否在首页 */
  const isHome = computed(() => getWorkspaceStageFlags(currentStage.value).isHome)

  /** 是否在配置页 */
  const isConfigure = computed(() => getWorkspaceStageFlags(currentStage.value).isConfigure)

  /** 是否在 Tech Library 页 */
  const isTech = computed(() => getWorkspaceStageFlags(currentStage.value).isTech)

  /** 是否在流程步骤页面 */
  const isFlowStep = computed(() => {
    return getWorkspaceStageFlags(currentStage.value).isFlowStep
  })

  /**
   * 获取阶段的完整路由路径
   */
  function getStagePath(stagePath: string): string {
    return `/workspace/${stagePath}`
  }

  /**
   * 检查指定阶段是否为当前阶段
   */
  function isCurrentStage(stagePath: string): boolean {
    return currentStage.value === stagePath
  }

  return {
    // 状态
    currentStage,
    showProgressPanel,
    showOverviewPanel,
    showSubflowPanel,
    isHome,
    isConfigure,
    isTech,
    isFlowStep,

    // 方法
    getStagePath,
    isCurrentStage
  }
}
