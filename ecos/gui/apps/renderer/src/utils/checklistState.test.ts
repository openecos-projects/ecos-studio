import { describe, expect, it } from 'vitest'

import {
  checklistStateClass,
  checklistStateIcon,
  isChecklistPassed,
  normalizeChecklistState,
} from './checklistState'

describe('checklistState', () => {
  it('maps new and legacy states to visual kinds', () => {
    expect(normalizeChecklistState('Passed')).toBe('success')
    expect(normalizeChecklistState('Success')).toBe('success')
    expect(normalizeChecklistState('Failed')).toBe('failed')
    expect(normalizeChecklistState('Warning')).toBe('warning')
    expect(normalizeChecklistState('Unstart')).toBe('unstart')
  })

  it('treats passed-like states as completed', () => {
    expect(isChecklistPassed('Passed')).toBe(true)
    expect(isChecklistPassed('Success')).toBe(true)
    expect(isChecklistPassed('Failed')).toBe(false)
  })

  it('returns css class and icon helpers', () => {
    expect(checklistStateClass('Passed')).toBe('state-success')
    expect(checklistStateIcon('Failed')).toBe('ri-close-circle-fill')
  })
})
