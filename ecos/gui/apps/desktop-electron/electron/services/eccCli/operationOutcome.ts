import type { EccRuntimeOperation } from '@ecos-studio/shared'
import type { PersistedFlow } from './persistedState'

const ADVISORY_STEPS = new Set(['antenna_check', 'emir'])

export interface BlockedFlowStep {
  failedItems: string[]
  step: string
}

export function terminalState(
  flow: PersistedFlow | null,
  cancelled: boolean,
  exit?: { code: number | null },
): EccRuntimeOperation['state'] {
  if (cancelled) return 'cancelled'
  if (exit) {
    if (exit.code === null) return 'interrupted'
    return exit.code === 0 ? 'succeeded' : 'failed'
  }
  // A run adopted from the terminal has no child exit status available.
  const steps = flow?.steps ?? []
  if (steps.some(({ state }) => state === 'Ongoing')) return 'interrupted'
  if (
    steps.some(
      ({ name, state }) =>
        state === 'Invalid' || (state === 'Incomplete' && !ADVISORY_STEPS.has(name)),
    )
  )
    return 'failed'
  if (
    steps.length &&
    steps.every(
      ({ name, state }) =>
        state === 'Success' ||
        state === 'Skipped' ||
        (state === 'Incomplete' && ADVISORY_STEPS.has(name)),
    )
  )
    return 'succeeded'
  return 'interrupted'
}

export function blockedFlowStep(
  flow: PersistedFlow,
  selectedStep?: string,
  fromStep?: string,
): BlockedFlowStep | null {
  for (const step of runSteps(flow, selectedStep, fromStep)) {
    if (!step.checklistBlocked) continue
    if (['Success', 'Skipped'].includes(step.state)) continue
    return {
      failedItems: step.checklistFailedItems ?? [],
      step: step.name,
    }
  }
  return null
}

export function failedRunSteps(
  flow: PersistedFlow,
  selectedStep?: string,
  fromStep?: string,
) {
  return runSteps(flow, selectedStep, fromStep).filter(
    ({ name, state }) =>
      state === 'Invalid' ||
      (state === 'Incomplete' && (selectedStep || !ADVISORY_STEPS.has(name))),
  )
}

function runSteps(flow: PersistedFlow, selectedStep?: string, fromStep?: string) {
  if (selectedStep) return flow.steps.filter(({ name }) => name === selectedStep)
  const start = fromStep ? flow.steps.findIndex(({ name }) => name === fromStep) : 0
  return start < 0 ? [] : flow.steps.slice(start)
}
