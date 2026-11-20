import { describe, expect, it } from 'vitest'
import { parsePowerSummary } from './powerSummary'

describe('parsePowerSummary', () => {
  it('reads the canonical power_summary payload', () => {
    expect(
      parsePowerSummary({
        schema_version: 1,
        internal_uw: 120.5,
        switching_uw: 80,
        dynamic_uw: 200.5,
        leakage_uw: 3.25,
      }),
    ).toEqual({
      internalUw: 120.5,
      switchingUw: 80,
      dynamicUw: 200.5,
      leakageUw: 3.25,
    })
  })

  it('rejects a legacy duplicate metrics payload or malformed values', () => {
    expect(
      parsePowerSummary({
        metrics: {
          internal_uw: 120,
          switching_uw: 80,
          dynamic_uw: 200,
          leakage_uw: 3,
        },
      }),
    ).toBeNull()
    expect(
      parsePowerSummary({
        schema_version: 1,
        internal_uw: -1,
        switching_uw: 80,
        dynamic_uw: 200,
        leakage_uw: 3,
      }),
    ).toBeNull()
  })
})
