import { describe, expect, it } from 'vitest'
import { normalizeLogContent, presentLog } from './logPresentation'

describe('log presentation', () => {
  it('classifies simulation failures, warnings, passes, and execution phases', () => {
    const lines = presentLog(
      [
        '[build_soc_sim] Compiling Verilator model',
        '%Warning-UNUSEDSIGNAL: signal is unused',
        '[soc-sim][difftest] passed: commits=42 compared=42',
        'ERROR: HIT BAD TRAP: difftest mismatch',
        'cycles=1200',
      ].join('\n'),
    )

    expect(lines.map((line) => line.tone)).toEqual([
      'phase',
      'warning',
      'success',
      'error',
      'plain',
    ])
    expect(lines.map((line) => line.number)).toEqual([1, 2, 3, 4, 5])
  })

  it('does not mark zero issue summaries as failures', () => {
    expect(presentLog('0 errors, 0 warnings')[0]?.tone).toBe('success')
    expect(presentLog('errors: 0; warnings: 0')[0]?.tone).toBe('success')
    expect(presentLog('0 failed, 12 passed')[0]?.tone).toBe('success')
  })

  it('gives non-zero errors and warnings priority over successful counts', () => {
    expect(presentLog('0 errors, 1 warning')[0]?.tone).toBe('warning')
    expect(presentLog('errors: 2; warnings: 0')[0]?.tone).toBe('error')
  })

  it('removes terminal color controls before presenting a line', () => {
    const escape = String.fromCharCode(27)
    expect(presentLog(`${escape}[31mERROR: mismatch${escape}[0m`)).toEqual([
      { number: 1, text: 'ERROR: mismatch', tone: 'error' },
    ])
  })

  it('normalizes carriage returns without changing log text', () => {
    expect(normalizeLogContent('first\r\nsecond\rthird')).toBe('first\nsecond\nthird')
  })
})
