import type { DesktopAgentInteractionRequest } from '@ecos-studio/shared'
import { sameCapturedFlowStep } from '@/composables/flowRunArtifacts'
import type { Message } from '../types'

export type InteractionAnswer =
  | { optionId: string }
  | { text: string }
  | { values: Record<string, string | number | null> }

export interface ChatStepArtifactGroup {
  id: string
  kind: 'step-artifacts'
  step: string
  messages: Message[]
}

export type ChatTurnItem = Message | ChatStepArtifactGroup

export interface ChatTurn {
  id: string
  user?: Message
  responses: ChatTurnItem[]
}

export interface PendingInteractionPresentation {
  companionMessageId?: string
  interaction?: NonNullable<Message['interaction']>
}

export function describeInteractionAnswer(
  interaction: DesktopAgentInteractionRequest,
  answer: InteractionAnswer,
): string {
  if ('text' in answer) return answer.text.trim()
  if ('optionId' in answer) {
    const payload = interaction.interaction
    if (payload.kind === 'choice') {
      return (
        payload.options.find((option) => option.id === answer.optionId)?.label ??
        'Selected'
      )
    }
    if (payload.kind === 'confirm') {
      return (
        [payload.confirm, payload.cancel].find((option) => option.id === answer.optionId)
          ?.label ?? 'Selected'
      )
    }
  }
  if ('values' in answer && interaction.interaction.kind === 'form') {
    const values = interaction.interaction.fields
      .map((field) => answer.values[field.id])
      .filter((value) => value !== null && String(value).trim() !== '')
    if (values.length) return values.map(String).join(', ')
    return /parameter/i.test(interaction.title) ? 'Keep current values' : 'Skipped'
  }
  return 'Selected'
}

/** Present only prompt ownership explicitly recorded when the interaction arrived. */
export function pendingInteractionPresentation(
  messages: Message[],
): PendingInteractionPresentation {
  let interactionIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.interaction?.status !== 'pending') continue
    interactionIndex = index
    break
  }
  if (interactionIndex < 0) return {}
  const interaction = messages[interactionIndex]?.interaction
  const interactionMessage = messages[interactionIndex]
  if (!interaction) return {}
  return {
    ...(interactionMessage?.interactionCompanionId
      ? { companionMessageId: interactionMessage.interactionCompanionId }
      : {}),
    interaction,
  }
}

export function isChatStepArtifactGroup(
  item: ChatTurnItem,
): item is ChatStepArtifactGroup {
  return 'kind' in item && item.kind === 'step-artifacts'
}

export function guiArtifactStep(message: Message): string | null {
  if (!message.isGuiArtifact) return null
  const step = message.infoData?.step ?? message.mapData?.step ?? ''
  return step.trim() || null
}

/** GUI report/layout cards for one step fold into a single group within the turn. */
export function groupTurnResponses(messages: Message[]): ChatTurnItem[] {
  const items: ChatTurnItem[] = []
  const groups: ChatStepArtifactGroup[] = []

  for (const message of messages) {
    const step = guiArtifactStep(message)
    if (!step) {
      items.push(message)
      continue
    }
    const group = groups.find((candidate) => sameCapturedFlowStep(candidate.step, step))
    if (group) {
      group.messages.push(message)
      continue
    }
    const created: ChatStepArtifactGroup = {
      id: `step_${message.id}`,
      kind: 'step-artifacts',
      step,
      messages: [message],
    }
    groups.push(created)
    items.push(created)
  }
  return items
}

/** Group a flat chat list into Cursor-style turns: each user message anchors the following assistant nodes. */
export function groupMessagesIntoTurns(messages: Message[]): ChatTurn[] {
  const turns: Array<{ id: string; user?: Message; responses: Message[] }> = []
  let current: { id: string; user?: Message; responses: Message[] } | null = null

  for (const message of messages) {
    if (message.role === 'user') {
      current = { id: message.id, user: message, responses: [] }
      turns.push(current)
      continue
    }

    if (!current) {
      current = { id: `lead_${message.id}`, responses: [] }
      turns.push(current)
    }
    current.responses.push(message)
  }

  return turns.map((turn) => ({
    id: turn.id,
    user: turn.user,
    responses: groupTurnResponses(turn.responses),
  }))
}
