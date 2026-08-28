import { describe, expect, it } from 'vitest'

import { losslessOptionalRecord } from './numbers'

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
