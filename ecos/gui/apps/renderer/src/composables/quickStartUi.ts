import type { QuickStartWorkflowEvent } from './quickStartWorkflow'

export const quickStartRunnerKey = Symbol('quickStartRunner')

export type QuickStartRunner = (
  onEvent?: (event: QuickStartWorkflowEvent) => void,
  signal?: AbortSignal,
) => Promise<void>
