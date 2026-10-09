import { expect, it } from 'vitest'
import type { DesktopAgentInteractionRequest } from '@ecos-studio/shared'
import { isQuickStartChoice, isQuickStartNextChoice } from './quickStartUi'

it('recognizes only the explicit Quick Start action regardless of option order', () => {
  const request = {
    interaction: {
      kind: 'choice',
      options: [
        { id: 'optimize_current', label: 'Optimize current design' },
        { id: 'quick_start', label: 'Quick Start' },
      ],
    },
  } as DesktopAgentInteractionRequest
  expect(isQuickStartChoice(request, 'optimize_current')).toBe(false)
  expect(isQuickStartChoice(request, 'quick_start')).toBe(true)
  request.interaction = {
    kind: 'choice',
    variant: 'buttons',
    options: [{ id: 'create_flow', label: 'Run your own flow' }],
  }
  expect(isQuickStartChoice(request, 'create_flow')).toBe(false)
  expect(isQuickStartChoice(request, 'quick_start')).toBe(false)
  expect(isQuickStartNextChoice(request)).toBe(false)
  request.interaction.options.push({ id: 'manual_rerun', label: 'Rerun' })
  expect(isQuickStartNextChoice(request)).toBe(true)
})
