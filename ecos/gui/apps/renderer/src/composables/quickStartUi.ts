import type { QuickStartWorkflowEvent } from './quickStartWorkflow'

export const quickStartRunnerKey = Symbol('quickStartRunner')

export type QuickStartNarration = (message: string) => void

export type QuickStartRunner = (
  onEvent?: (event: QuickStartWorkflowEvent) => void,
  signal?: AbortSignal,
  onNarration?: QuickStartNarration,
) => Promise<void>
