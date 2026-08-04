import { describe, expect, it } from 'vitest'
import { resolveReviewStructuralStatus } from './frontendReviewPresentation'

describe('frontend review presentation', () => {
  it('presents legacy tool frontend limitations as tool limited', () => {
    expect(
      resolveReviewStructuralStatus({
        status: 'failed',
        diagnostics: [
          {
            severity: 'error',
            category: 'tool-limit',
            message: 'Feature unimplemented in slang frontend',
          },
        ],
      }),
    ).toBe('tool_limited')
  })

  it('keeps real precheck failures failed', () => {
    expect(
      resolveReviewStructuralStatus({
        status: 'failed',
        diagnostics: [{ severity: 'error', category: 'syntax' }],
      }),
    ).toBe('failed')
    expect(
      resolveReviewStructuralStatus({
        status: 'failed',
        diagnostics: [
          { severity: 'error', category: 'tool-limit' },
          { severity: 'error', category: 'hierarchy' },
        ],
      }),
    ).toBe('failed')
  })

  it('passes through current status values and supplies the empty state', () => {
    expect(resolveReviewStructuralStatus({ status: 'success' })).toBe('success')
    expect(resolveReviewStructuralStatus({ status: 'tool_limited' })).toBe('tool_limited')
    expect(resolveReviewStructuralStatus(null)).toBe('not_run')
  })
})
