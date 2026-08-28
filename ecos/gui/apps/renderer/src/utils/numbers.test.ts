import { describe, expect, it } from 'vitest'

import { losslessNumber, losslessNumberList, losslessOptionalRecord } from './numbers'

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
