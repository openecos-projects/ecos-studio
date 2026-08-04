import { describe, expect, it } from 'vitest'
import {
  resolveReviewStructuralStatus,
  selectLintRuleDiagnostic,
} from './frontendReviewPresentation'

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

  it('selects an actionable CPU diagnostic when opening a lint rule', () => {
    const socDiagnostic = {
      code: 'UNUSEDSIGNAL',
      source: '/resources/ysyxSoCFull.v',
      ownership: 'soc',
      actionable: false,
    }
    const cpuDiagnostic = {
      code: 'UNUSEDSIGNAL',
      source: '/project/CL3Issue.sv',
      ownership: 'cpu',
      actionable: true,
    }

    expect(selectLintRuleDiagnostic('unusedsignal', [socDiagnostic, cpuDiagnostic])).toBe(
      cpuDiagnostic,
    )
  })

  it('falls back to a located diagnostic when a lint rule has no CPU hit', () => {
    const locatedDiagnostic = {
      code: 'PROCASSINIT',
      source: '/resources/ysyxSoCFull.v',
      ownership: 'soc',
    }

    expect(selectLintRuleDiagnostic('PROCASSINIT', [locatedDiagnostic])).toBe(
      locatedDiagnostic,
    )
    expect(selectLintRuleDiagnostic('BLKSEQ', [locatedDiagnostic])).toBeNull()
  })
})
