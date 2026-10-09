import type { QuickStartWorkflowEvent } from './quickStartWorkflow'
import type { QuickStartFlowResult } from './quickStartFlow'
import type { DesktopAgentInteractionRequest } from '@ecos-studio/shared'

export const quickStartRunnerKey = Symbol('quickStartRunner')

export function isQuickStartChoice(
  request: DesktopAgentInteractionRequest,
  optionId: string,
): boolean {
  return (
    request.interaction.kind === 'choice' &&
    optionId === 'quick_start' &&
    request.interaction.options.some((option) => option.id === optionId)
  )
}

export function isQuickStartNextChoice(request: DesktopAgentInteractionRequest): boolean {
  return (
    request.interaction.kind === 'choice' &&
    request.interaction.options.some((option) => option.id === 'manual_rerun') &&
    request.interaction.options.every((option) =>
      ['optimize_current', 'manual_rerun', 'create_flow', 'continue_flow'].includes(
        option.id,
      ),
    )
  )
}

export type QuickStartNarration = (message: string) => void

export type QuickStartRunner = (
  onEvent?: (event: QuickStartWorkflowEvent) => void,
  signal?: AbortSignal,
  onNarration?: QuickStartNarration,
) => Promise<QuickStartFlowResult>
