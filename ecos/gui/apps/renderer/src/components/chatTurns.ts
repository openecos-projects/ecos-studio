import type { Message } from '../types'

export interface ChatTurn {
  id: string
  user?: Message
  responses: Message[]
}

export interface PendingInteractionPresentation {
  companionMessageId?: string
  interaction?: NonNullable<Message['interaction']>
}

/** Move the prompt immediately preceding a pending interaction into its card. */
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
  if (!interaction || interaction.description) return { interaction }

  const companion = messages[interactionIndex - 1]
  if (
    companion?.role !== 'assistant' ||
    companion.type !== 'text' ||
    companion.status !== 'done' ||
    !companion.content.trim()
  ) {
    return { interaction }
  }
  return {
    companionMessageId: companion.id,
    interaction: { ...interaction, description: companion.content.trim() },
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
