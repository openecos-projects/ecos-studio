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
  selectedStep?: string,
  fromStep?: string,
  throughStep?: string,
): EccRuntimeOperation['state'] {
  if (cancelled) return 'cancelled'
  if (exit) {
    if (exit.code === null) return 'interrupted'
    return exit.code === 0 ? 'succeeded' : 'failed'
  }
  // Fallback for runtimes that predate persisted run results.
  const steps = flow ? runSteps(flow, selectedStep, fromStep, throughStep) : []
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
  throughStep?: string,
): BlockedFlowStep | null {
  for (const step of runSteps(flow, selectedStep, fromStep, throughStep)) {
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
  throughStep?: string,
) {
  return runSteps(flow, selectedStep, fromStep, throughStep).filter(
    ({ name, state }) =>
      state === 'Invalid' ||
      (state === 'Incomplete' && (selectedStep || !ADVISORY_STEPS.has(name))),
  )
}

function runSteps(
  flow: PersistedFlow,
  selectedStep?: string,
  fromStep?: string,
  throughStep?: string,
) {
  if (selectedStep) return flow.steps.filter(({ name }) => name === selectedStep)
  const start = fromStep ? flow.steps.findIndex(({ name }) => name === fromStep) : 0
  const end = throughStep
    ? flow.steps.findIndex(({ name }) => name === throughStep)
    : flow.steps.length - 1
  return start < 0 || end < start ? [] : flow.steps.slice(start, end + 1)
}
