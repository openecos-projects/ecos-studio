import type { DesktopAgentActivity } from '@ecos-studio/shared'
import MarkdownIt from 'markdown-it'
import { sanitizeHtml } from '@/utils/sanitizeHtml'

const activityMarkdown = new MarkdownIt({ html: false, linkify: true, typographer: true })
const defaultLinkOpen = activityMarkdown.renderer.rules.link_open
activityMarkdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]?.attrSet('target', '_blank')
  tokens[index]?.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen
    ? defaultLinkOpen(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options)
}

export function renderAgentActivityMarkdown(value: string): string {
  return sanitizeHtml(activityMarkdown.render(value))
}

export function agentActivityLabel(item: DesktopAgentActivity): string {
  if (item.kind === 'reasoning_summary') {
    return item.summary[item.summary.length - 1] || 'Reasoning'
  }
  if (item.kind === 'web_search') {
    const verb = item.status === 'running' ? 'Searching' : 'Searched'
    return item.query ? `${verb} the web for “${item.query}”` : `${verb} the web`
  }
  if (item.kind === 'command_execution') return item.label
  return item.server ? `${item.server} · ${item.tool}` : item.tool
}

export function agentActivityKindLabel(item: DesktopAgentActivity): string {
  if (item.kind === 'reasoning_summary') return 'Reasoning'
  if (item.kind === 'web_search') return 'Web search'
  if (item.kind === 'command_execution') return 'Command'
  return 'Tool call'
}

export function agentActivityTerminalLabel(item: DesktopAgentActivity): string {
  if (item.status === 'failed') return 'Failed'
  if (item.status === 'declined') return 'Declined'
  if (item.status === 'interrupted') return 'Interrupted'
  return ''
}

export function formatActivityDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`
  if (durationMs < 60_000) return `${Math.max(1, Math.round(durationMs / 1000))}s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export function agentActivityUpdateKey(item: DesktopAgentActivity): string {
  if (item.kind === 'reasoning_summary') {
    return `${item.itemId}:${item.status}:${item.summary.reduce((sum, part) => sum + part.length, 0)}`
  }
  if (item.kind === 'web_search') {
    return `${item.itemId}:${item.status}:${item.actions.length}:${item.query?.length ?? 0}`
  }
  if (item.kind === 'command_execution') {
    return `${item.itemId}:${item.status}:${item.output?.length ?? 0}`
  }
  return `${item.itemId}:${item.status}:${item.progress?.length ?? 0}:${item.result?.length ?? 0}`
}
