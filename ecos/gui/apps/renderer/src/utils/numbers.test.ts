import { describe, expect, it } from 'vitest'

import {
  losslessNumber,
  losslessNumberList,
  losslessOptionalNumber,
  losslessOptionalRecord,
  losslessOptionalString,
  scalarMarginFromCore,
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

  it('rejects tables and arrays instead of coercing them to numbers', () => {
    expect(() => losslessNumber([], 'max_fanout')).toThrow(
      /must be a scalar, not an array/,
    )
    expect(() => losslessNumber([20], 'max_fanout')).toThrow(
      /must be a scalar, not an array/,
    )
    expect(() => losslessNumber({ n: 1 }, 'max_fanout')).toThrow(
      /must be a scalar, not a table/,
    )
  })
})

describe('losslessOptionalString', () => {
  it('returns an empty string for omitted values', () => {
    expect(losslessOptionalString(undefined, 'design')).toBe('')
    expect(losslessOptionalString(null, 'design')).toBe('')
  })

  it('keeps a defined non-empty string', () => {
    expect(losslessOptionalString(' gcd ', 'design')).toBe('gcd')
  })

  it('rejects tables and arrays instead of converting them to empty strings', () => {
    expect(() => losslessOptionalString({ extra: 'keep-me' }, 'design')).toThrow(
      /must be a scalar, not a table/,
    )
    expect(() => losslessOptionalString(['gcd'], 'design')).toThrow(
      /must be a scalar, not an array/,
    )
  })
})

describe('losslessNumberList', () => {
  it('rejects invalid members instead of dropping them and shifting the rest', () => {
    expect(() => losslessNumberList(['invalid', 200], 'Die.Size')).toThrow(
      /finite number|round-trip/,
    )
  })

  it('rejects null and boolean members instead of coercing them to numbers', () => {
    expect(() => losslessNumberList([null, 4], 'Core.Margin')).toThrow(/must be a number/)
    expect(() => losslessNumberList([true, 4], 'Core.Margin')).toThrow(/must be a number/)
    expect(() => losslessNumberList([false, 200], 'Die.Size')).toThrow(/must be a number/)
  })
})

describe('scalarMarginFromCore', () => {
  it('returns the shared value for a symmetric margin', () => {
    expect(scalarMarginFromCore([4, 4], 'workspace parameter')).toBe(4)
  })

  it('rejects an asymmetric margin instead of keeping only the first component', () => {
    expect(() => scalarMarginFromCore([5, 7], 'workspace parameter')).toThrow(
      /coreMargin cannot be represented/,
    )
  })
})
