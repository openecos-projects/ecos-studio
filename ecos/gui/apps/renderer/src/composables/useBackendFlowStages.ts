import { computed, ref } from 'vue'
import type { FlowStepState } from '@ecos-studio/shared'
import { getStepMetadata, STEP_METADATA } from '@/api/type'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'
import { useWorkspace } from './useWorkspace'
import { projectBackendFlowSteps } from './backendFlowProjection'

export interface BackendFlowStage {
  label: string
  path: string
  icon: string
  group: 'setup' | 'run'
  tool: string
  state: string
  runtime: string
  'peak memory (mb)': number
}

const setupStages: BackendFlowStage[] = Object.values(STEP_METADATA)
  .filter((metadata) => metadata.group === 'setup' && metadata.showInSidebar)
  .map((metadata) => ({
    label: metadata.label,
    path: metadata.path,
    icon: metadata.icon,
    group: 'setup',
    tool: '',
    state: 'pending',
    runtime: '',
    'peak memory (mb)': 0,
  }))

const optimisticRun = ref<{
  projectPath: string
  resetAll: boolean
  runtimeEventCursor: unknown
  stepPath: string
} | null>(null)

function normalizedPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/$/, '')
}

function formatRuntime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return ''
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = seconds % 60
  const secondText = Number.isInteger(remaining)
    ? String(remaining).padStart(2, '0')
    : remaining.toFixed(3).replace(/0+$/, '').padStart(2, '0')
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${secondText}`
}

function displayFlowState(state: FlowStepState): string {
  if (state === 'succeeded') return 'Success'
  if (state === 'running') return 'Ongoing'
  if (state === 'failed' || state === 'cancelled') return 'Incomplete'
  if (state === 'skipped') return 'Skipped'
  if (state === 'unknown') return 'Invalid'
  return 'Unstart'
}

export function useBackendFlowStages() {
  const session = useBackendWorkspaceSession()
  const backgroundOperations = useBackgroundOperationStore()
  const { backendRuntimeEvents, currentProject } = useWorkspace()

  const committedSteps = computed(() => {
    const section = session.projection.data?.flow
    return section?.status === 'ready' || section?.status === 'partial'
      ? section.data.steps
      : []
  })
  const projectedSteps = computed(() => {
    const steps = projectBackendFlowSteps(
      committedSteps.value,
      backendRuntimeEvents.value,
    )
    const revision = session.projection.data?.revision
    const operation =
      revision?.status === 'ready'
        ? backgroundOperations.operationForWorkspace(
            revision.data.workspaceId,
            revision.data.workspaceRevision,
          )
        : undefined
    const operationStep = operation?.currentStep || operation?.step
    if (operationStep) {
      const key = operationStep.trim().toLowerCase()
      for (const step of steps) {
        if (step.state === 'running') step.state = 'not-started'
      }
      const activeStep = steps.find(
        (step) =>
          step.stepId.trim().toLowerCase() === key ||
          step.name.trim().toLowerCase() === key ||
          (getStepMetadata(step.stepId)?.path ?? '').toLowerCase() === key,
      )
      if (activeStep) {
        activeStep.state = 'running'
        if (operation.currentTool) activeStep.toolId = operation.currentTool
      }
    }
    const request = optimisticRun.value
    if (
      !request ||
      request.projectPath !== normalizedPath(currentProject.value?.path ?? '')
    ) {
      return steps
    }
    const latestRuntimeEvent =
      backendRuntimeEvents.value[backendRuntimeEvents.value.length - 1]
    if (latestRuntimeEvent && latestRuntimeEvent !== request.runtimeEventCursor) {
      return steps
    }
    if (steps.some((step) => step.state === 'running')) return steps
    const next = steps.map((step) => ({
      ...step,
      ...(request.resetAll ? { state: 'not-started' as const } : {}),
    }))
    const target = request.stepPath
      ? next.find(
          (step) =>
            step.stepId.toLowerCase() === request.stepPath.toLowerCase() ||
            (getStepMetadata(step.stepId)?.path ?? '').toLowerCase() ===
              request.stepPath.toLowerCase(),
        )
      : next.find((step) => step.state !== 'succeeded')
    if (target) target.state = 'running'
    return next
  })
  const dynamicFlowStages = computed<BackendFlowStage[]>(() =>
    projectedSteps.value.map((step) => {
      const metadata = getStepMetadata(step.stepId)
      return {
        label: metadata?.label ?? step.name,
        path: metadata?.path ?? step.stepId,
        icon: metadata?.icon ?? 'ri-checkbox-blank-circle-line',
        group: 'run',
        tool: step.toolId ?? '',
        state: displayFlowState(step.state),
        runtime: formatRuntime(step.runtimeSeconds),
        'peak memory (mb)': step.peakMemoryMb ?? 0,
      }
    }),
  )
  const flowStages = computed(() => [...setupStages, ...dynamicFlowStages.value])
  const hasOngoingRunStage = computed(() =>
    dynamicFlowStages.value.some((stage) => stage.state === 'Ongoing'),
  )
  const isLoading = computed(
    () =>
      session.projection.status === 'idle' ||
      session.projection.status === 'loading' ||
      session.projection.status === 'refreshing',
  )
  const error = computed(() =>
    session.projection.status === 'error' || session.projection.status === 'stale'
      ? (session.projection.issue.detail ?? session.projection.issue.code)
      : null,
  )

  function setFirstRunStepOngoing(options: { resetAll?: boolean } = {}): void {
    optimisticRun.value = {
      projectPath: normalizedPath(currentProject.value?.path ?? ''),
      resetAll: Boolean(options.resetAll),
      runtimeEventCursor:
        backendRuntimeEvents.value[backendRuntimeEvents.value.length - 1] ?? null,
      stepPath: '',
    }
  }

  function setRunStepOngoingByPath(stepPath: string): void {
    optimisticRun.value = {
      projectPath: normalizedPath(currentProject.value?.path ?? ''),
      resetAll: false,
      runtimeEventCursor:
        backendRuntimeEvents.value[backendRuntimeEvents.value.length - 1] ?? null,
      stepPath,
    }
  }

  async function refreshFlowStages(): Promise<void> {
    await session.refresh()
    optimisticRun.value = null
  }

  return {
    clearFlowStages: session.clear,
    dynamicFlowStages,
    error,
    flowStages,
    hasOngoingRunStage,
    isLoading,
    loadFlowStages: session.load,
    refreshFlowStages,
    setFirstRunStepOngoing,
    setRunStepOngoingByPath,
  }
}
