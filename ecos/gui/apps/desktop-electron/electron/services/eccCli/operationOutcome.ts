import type { EccRuntimeOperation } from '@ecos-studio/shared'
import type { PersistedFlow } from './persistedState'

const ADVISORY_STEPS = new Set(['antennaCheck', 'emir'])

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
