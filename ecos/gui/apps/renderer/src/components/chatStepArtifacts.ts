import type { Message } from '../types'

export type ChatStepArtifactKind = 'report' | 'layout'

export interface ChatStepArtifactOption {
  id: string
  kind: ChatStepArtifactKind
  label: string
  message: Message
}

export function chatStepArtifactLabel(message: Message): string {
  if (message.type === 'map') {
    return message.mapData?.title?.trim() || 'Layout preview'
  }
  return message.infoData?.title?.trim() || message.content || 'Report'
}

export function chatStepArtifactOptions(messages: Message[]): ChatStepArtifactOption[] {
  return messages.map((message) => ({
    id: message.id,
    kind: message.type === 'map' ? 'layout' : 'report',
    label: chatStepArtifactLabel(message),
    message,
  }))
}

export function chatStepArtifactSummary(messages: Message[]): string {
  const reports = messages.filter((message) => message.type !== 'map').length
  const layouts = messages.length - reports
  const parts: string[] = []
  if (reports) parts.push(`${reports} report${reports === 1 ? '' : 's'}`)
  if (layouts) parts.push(`${layouts} layout${layouts === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'Results'
}
