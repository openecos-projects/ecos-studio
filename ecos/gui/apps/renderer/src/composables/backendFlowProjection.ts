import type { FlowStepState, FlowStepSummary } from '@ecos-studio/shared'

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeState(value: unknown, fallback: FlowStepState): FlowStepState {
  if (typeof value !== 'string') return fallback
  switch (value.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'completed':
    case 'complete':
      return 'succeeded'
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

export function projectBackendFlowSteps(
  committed: readonly FlowStepSummary[],
  runtimeEvents: readonly unknown[],
): FlowStepSummary[] {
  const steps = committed.map((step) => ({ ...step }))

  for (const event of runtimeEvents) {
    const eventRecord = record(event)
    const data = record(eventRecord?.data)
    if (!data) continue
    const protocolType =
      typeof data.runtimeProtocolType === 'string' ? data.runtimeProtocolType : ''
    const legacyType = typeof data.type === 'string' ? data.type : ''
    const cancelled =
      protocolType === 'operation.cancelled' ||
      (!protocolType && legacyType === 'cancelled')
    const terminalFailure =
      protocolType === 'operation.failed' ||
      cancelled ||
      (!protocolType && legacyType === 'error')
    if (terminalFailure) {
      for (const step of steps) {
        if (step.state === 'running') step.state = cancelled ? 'cancelled' : 'failed'
      }
      continue
    }

    const started =
      protocolType === 'step.started' || (!protocolType && legacyType === 'step_start')
    const completed =
      protocolType === 'step.completed' ||
      (!protocolType && legacyType === 'step_complete')
    if (!started && !completed) continue

    const stepName = typeof data.step === 'string' ? data.step : ''
    if (!stepName) continue
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
    const phase = typeof data.phase === 'string' ? data.phase : ''
    const response = eventRecord?.response
    const fallback: FlowStepState = started
      ? 'running'
      : response === 'failed' || phase === 'failed'
        ? 'failed'
        : response === 'error'
          ? 'failed'
          : 'succeeded'
    step.state = normalizeState(data.state, fallback)
    if (typeof data.tool === 'string' && data.tool) step.toolId = data.tool
  }

  return steps.sort((left, right) => left.order - right.order)
}
