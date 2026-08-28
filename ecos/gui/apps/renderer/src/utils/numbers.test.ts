import { describe, expect, it } from 'vitest'

import {
  losslessNumber,
  losslessNumberList,
  losslessOptionalNumber,
  losslessOptionalRecord,
} from './numbers'

describe('losslessOptionalRecord', () => {
  it('returns null for a missing table', () => {
    expect(losslessOptionalRecord(undefined, 'core')).toBeNull()
    expect(losslessOptionalRecord(null, 'die')).toBeNull()
  })

  it('rejects a defined scalar where a table is expected', () => {
    expect(() => losslessOptionalRecord(1, 'core')).toThrow(/must be a table/)
    expect(() => losslessOptionalRecord('bad', 'die')).toThrow(/must be a table/)
  })
})

describe('losslessOptionalNumber', () => {
  it('returns the fallback for omitted values', () => {
    expect(losslessOptionalNumber(undefined, 32, 'max_fanout')).toBe(32)
    expect(losslessOptionalNumber(null, 50, 'frequency_max')).toBe(50)
  })

  it('keeps a defined finite number', () => {
    expect(losslessOptionalNumber(20, 32, 'max_fanout')).toBe(20)
  })

  it('rejects defined unrepresentable values instead of falling back', () => {
    expect(() =>
      losslessOptionalNumber(Number.MAX_SAFE_INTEGER + 1, 32, 'max_fanout'),
    ).toThrow(/safe integer range/)
    expect(() =>
      losslessOptionalNumber(new Date('1979-05-27T00:00:00Z'), 32, 'max_fanout'),
    ).toThrow(/date/)
  })
})

describe('losslessNumber', () => {
  it('rejects numeric strings that cannot round-trip exactly', () => {
    expect(() => losslessNumber('9007199254740993', 'Area')).toThrow(
      /safe integer range|round-trip/,
    )
  })
})

describe('losslessNumberList', () => {
  it('rejects invalid members instead of dropping them and shifting the rest', () => {
    expect(() => losslessNumberList(['invalid', 200], 'Die.Size')).toThrow(
      /finite number|round-trip/,
    )
  })
})
