import type { Message } from '../types'

export interface ChatTurn {
  id: string
  user?: Message
  responses: Message[]
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
