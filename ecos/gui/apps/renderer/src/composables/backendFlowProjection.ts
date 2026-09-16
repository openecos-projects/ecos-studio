import type {
  DesignRuntimeEvent,
  FlowStepState,
  FlowStepSummary,
} from '@ecos-studio/shared'

function normalizeState(value: unknown, fallback: FlowStepState): FlowStepState {
  if (typeof value !== 'string') return fallback
  switch (value.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'completed':
    case 'complete':
      return 'succeeded'
    case 'warning':
      return 'warning'
    case 'ongoing':
    case 'running':
      return 'running'
    case 'incomplete':
      return 'failed'
    case 'invalid':
    case 'failed':
    case 'failure':
    case 'error':
      return 'failed'
    case 'pending':
    case 'unstart':
    case 'unstarted':
    case 'not_started':
    case 'not-started':
    case 'not started':
      return 'not-started'
    case 'skipped':
      return 'skipped'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return fallback
  }
}

function stepKey(value: string): string {
  return value.trim().toLowerCase()
}

export function isObsoleteBackendFlowStep(value: string): boolean {
  return value.toLowerCase().replace(/[\s_-]/g, '') === 'fixfanout'
}

export function projectBackendFlowSteps(
  committed: readonly FlowStepSummary[],
  runtimeEvents: readonly DesignRuntimeEvent[],
): FlowStepSummary[] {
  const steps = committed
    .filter(
      (step) =>
        !isObsoleteBackendFlowStep(step.stepId) && !isObsoleteBackendFlowStep(step.name),
    )
    .map((step) => ({ ...step }))

  for (const event of runtimeEvents) {
    if (event.designTool !== 'backend') continue
    const data =
      event.type === 'runtime.protocol'
        ? event.event.payload
        : event.type === 'operation.progress'
          ? (event.data ?? {})
          : {}
    const protocolType =
      event.type === 'runtime.protocol' && typeof data.sourceType === 'string'
        ? data.sourceType
        : event.type
    const operationState = typeof data.state === 'string' ? data.state : ''
    const cancelled =
      protocolType === 'operation.cancelled' ||
      (event.type === 'runtime.protocol' &&
        event.event.type === 'operation.changed' &&
        operationState === 'cancelled')
    const terminalFailure =
      protocolType === 'operation.failed' ||
      cancelled ||
      (event.type === 'runtime.protocol' &&
        event.event.type === 'operation.changed' &&
        (operationState === 'failed' || operationState === 'interrupted')) ||
      (event.type === 'runtime.exited' && event.reason === 'unexpected')
    if (terminalFailure) {
      for (const step of steps) {
        if (step.state === 'running') step.state = cancelled ? 'cancelled' : 'failed'
      }
      continue
    }

    const started =
      protocolType === 'step.started' ||
      (event.type === 'operation.progress' &&
        event.phase === 'started' &&
        Boolean(event.step))
    const completed =
      protocolType === 'step.completed' ||
      (event.type === 'operation.progress' &&
        (event.phase === 'completed' || event.phase === 'failed') &&
        Boolean(event.step))
    if (!started && !completed) continue

    const stepName =
      typeof data.step === 'string'
        ? data.step
        : 'step' in event && typeof event.step === 'string'
          ? event.step
          : ''
    if (!stepName) continue
    if (isObsoleteBackendFlowStep(stepName)) continue
    if (started) {
      for (const step of steps) {
        if (step.state === 'running') step.state = 'not-started'
      }
    }
    const key = stepKey(stepName)
    let step = steps.find(
      (candidate) => stepKey(candidate.stepId) === key || stepKey(candidate.name) === key,
    )
    if (!step) {
      step = {
        name: stepName,
        order: steps.length,
        state: 'not-started',
        stepId: stepName,
      }
      steps.push(step)
    }
    const phase =
      event.type === 'operation.progress'
        ? event.phase
        : typeof data.phase === 'string'
          ? data.phase
          : ''
    const fallback: FlowStepState = started
      ? 'running'
      : phase === 'failed'
        ? 'failed'
        : 'succeeded'
    step.state = normalizeState(data.state, fallback)
    if (typeof data.tool === 'string' && data.tool) step.toolId = data.tool
  }

  return steps.sort((left, right) => left.order - right.order)
}
