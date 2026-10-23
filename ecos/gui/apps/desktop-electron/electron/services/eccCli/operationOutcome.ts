import type { EccRuntimeOperation } from '@ecos-studio/shared'
import type { PersistedFlow } from './persistedState'

const ADVISORY_STEPS = new Set(['antennaCheck', 'emir'])

export interface BlockedFlowStep {
  failedItems: string[]
  step: string
}

export function terminalState(
  flow: PersistedFlow,
  cancelled: boolean,
): EccRuntimeOperation['state'] {
  if (cancelled) return 'cancelled'
  // Advisory execution failures remain in the ledger; they do not fail the flow.
  const states = flow.steps.map((step) =>
    ADVISORY_STEPS.has(step.name) && ['Incomplete', 'Imcomplete'].includes(step.state)
      ? 'Success'
      : step.state,
  )
  if (states.some((state) => ['Failed', 'Error'].includes(state))) return 'failed'
  if (
    states.some((state) => ['Interrupted', 'Incomplete', 'Imcomplete'].includes(state))
  ) {
    return 'interrupted'
  }
  if (
    states.length > 0 &&
    states.every((state) => ['Success', 'Skipped', 'Unstart'].includes(state))
  ) {
    return 'succeeded'
  }
  return 'interrupted'
}

export function blockedFlowStep(flow: PersistedFlow): BlockedFlowStep | null {
  for (const step of flow.steps) {
    if (!step.checklistBlocked) continue
    if (['Success', 'Skipped'].includes(step.state)) continue
    return {
      failedItems: step.checklistFailedItems ?? [],
      step: step.name,
    }
  }
  return null
}
