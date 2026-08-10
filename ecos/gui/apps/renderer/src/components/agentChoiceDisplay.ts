import type { DesktopAgentChoiceOption } from '@ecos-studio/shared'

const EMPTY_CHOICE_VALUE = '__empty__'

/** Concrete path/value to show under a short action label (e.g. "Use recommended path"). */
export function choiceOptionDetail(option: DesktopAgentChoiceOption): string {
  const value = option.value.trim()
  if (!value || value === EMPTY_CHOICE_VALUE) return ''
  if (value === option.label.trim()) return ''
  if (/^\d+$/.test(value)) return ''
  if (
    value.startsWith('/') ||
    value.startsWith('~') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    return value
  }
  return ''
}

export function choiceSelectionText(option: DesktopAgentChoiceOption): string {
  const detail = choiceOptionDetail(option)
  return detail ? `${option.label}\n${detail}` : option.label
}
