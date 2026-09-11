import { sameCapturedFlowStep } from '@/composables/flowRunArtifacts'
import type { Message } from '../types'

export interface ChatTurn {
  id: string
  user?: Message
  responses: ChatTurnItem[]
}

export interface ChatStepArtifactGroup {
  id: string
  kind: 'step-artifacts'
  step: string
  messages: Message[]
}

export type ChatTurnItem = Message | ChatStepArtifactGroup

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
