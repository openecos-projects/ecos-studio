import { describe, expect, it } from 'vitest'

import {
  assignOwnJsonPathValue,
  hasSafeJsonPath,
  readOwnJsonPathSegment,
} from './jsonPath.ts'

describe('hasSafeJsonPath', () => {
  it('rejects prototype-related segments', () => {
    expect(hasSafeJsonPath(['__proto__', 'toString'])).toBe(false)
    expect(hasSafeJsonPath(['constructor'])).toBe(false)
    expect(hasSafeJsonPath(['prototype'])).toBe(false)
  })

  it('accepts ordinary parameter leaves', () => {
    expect(hasSafeJsonPath(['Target density'])).toBe(true)
    expect(hasSafeJsonPath(['Core', 'Utilitization'])).toBe(true)
    expect(hasSafeJsonPath(['density_weight'])).toBe(true)
  })
})

describe('assignOwnJsonPathValue', () => {
  it('refuses to assign through inherited prototype properties', () => {
    const document: Record<string, unknown> = { density_weight: 0.2 }
    expect(() =>
      assignOwnJsonPathValue(document, ['__proto__', 'polluted'], 1, () => {
        throw new Error('missing')
      }),
    ).toThrow(/not allowed/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('updates an own leaf', () => {
    const document: Record<string, unknown> = { density_weight: 0.2 }
    assignOwnJsonPathValue(document, ['density_weight'], 0.1, () => {
      throw new Error('missing')
    })
    expect(document.density_weight).toBe(0.1)
  })

  it('does not treat inherited names as existing leaves', () => {
    expect(readOwnJsonPathSegment({}, 'toString')).toBeUndefined()
  })
})
