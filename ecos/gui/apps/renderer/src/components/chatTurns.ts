import type { DesktopAgentInteractionRequest } from '@ecos-studio/shared'
import type { Message } from '../types'

export type InteractionAnswer =
  | { optionId: string }
  | { text: string }
  | { values: Record<string, string | number | null> }

export interface ChatTurn {
  id: string
  user?: Message
  responses: Message[]
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

/** Group a flat chat list into Cursor-style turns: each user message anchors the following assistant nodes. */
export function groupMessagesIntoTurns(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  let current: ChatTurn | null = null

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

  return turns
}
