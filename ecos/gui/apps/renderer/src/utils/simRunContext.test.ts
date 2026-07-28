import { describe, expect, it } from 'vitest'

import {
  normalizeSimCaseNameForComparison,
  SIM_SUITE_IDS,
  simContextsEqual,
} from './simRunContext'

describe('simRunContext', () => {
  it('exposes only the supported simulation suites', () => {
    expect(SIM_SUITE_IDS).toEqual(['cpu_tests', 'coremark'])
  })

  it('treats CPU test source names and generated SoC case names as the same selection', () => {
    expect(
      simContextsEqual(
        { suite: 'cpu_tests', mode: 'selected', cases: ['add'] },
        { suite: 'cpu_tests', mode: 'selected', cases: ['add.soc'] },
      ),
    ).toBe(true)
  })

  it('normalizes generated SoC image names without hiding real case differences', () => {
    expect(normalizeSimCaseNameForComparison('cases/add.soc.bin')).toBe('add')
    expect(normalizeSimCaseNameForComparison('quick-sort.soc')).toBe('quick-sort')
    expect(
      simContextsEqual(
        { suite: 'cpu_tests', mode: 'selected', cases: ['add'] },
        { suite: 'cpu_tests', mode: 'selected', cases: ['sub.soc'] },
      ),
    ).toBe(false)
  })

  it('still requires the same suite and mode', () => {
    expect(
      simContextsEqual(
        { suite: 'cpu_tests', mode: 'selected', cases: ['add'] },
        { suite: 'coremark', mode: 'selected', cases: ['add.soc'] },
      ),
    ).toBe(false)
    expect(
      simContextsEqual(
        { suite: 'cpu_tests', mode: 'all', cases: [] },
        { suite: 'cpu_tests', mode: 'selected', cases: ['add.soc'] },
      ),
    ).toBe(false)
  })
})
