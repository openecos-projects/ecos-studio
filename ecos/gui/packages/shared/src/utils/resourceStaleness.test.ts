import { describe, expect, it } from 'vitest'
import {
  isResourceStalenessError,
  readResourceStalenessPayload,
  RESOURCE_UPDATE_AVAILABLE,
} from './resourceStaleness.ts'

describe('isResourceStalenessError', () => {
  it('matches errors carrying the stable code', () => {
    const error = Object.assign(new Error('stale'), { code: RESOURCE_UPDATE_AVAILABLE })
    expect(isResourceStalenessError(error)).toBe(true)
  })

  it('rejects other errors and non-objects', () => {
    expect(isResourceStalenessError(new Error('nope'))).toBe(false)
    expect(isResourceStalenessError({ code: 'OTHER_CODE' })).toBe(false)
    expect(isResourceStalenessError(null)).toBe(false)
    expect(isResourceStalenessError(RESOURCE_UPDATE_AVAILABLE)).toBe(false)
  })
})

describe('readResourceStalenessPayload', () => {
  it('returns null for non-staleness errors', () => {
    expect(readResourceStalenessPayload(new Error('x'))).toBeNull()
  })

  it('returns null when details are missing or malformed', () => {
    const noDetails = Object.assign(new Error('x'), { code: RESOURCE_UPDATE_AVAILABLE })
    expect(readResourceStalenessPayload(noDetails)).toBeNull()

    const badDetails = Object.assign(new Error('x'), {
      code: RESOURCE_UPDATE_AVAILABLE,
      details: { resources: 'not-an-array' },
    })
    expect(readResourceStalenessPayload(badDetails)).toBeNull()
  })

  it('parses a well-formed payload', () => {
    const error = Object.assign(new Error('x'), {
      code: RESOURCE_UPDATE_AVAILABLE,
      details: {
        resources: [
          {
            id: 'tool:yosys',
            display_name: 'Yosys',
            installed_version: '1.0',
            latest_version: '1.1',
            update_kind: 'version',
          },
          {
            id: 'pdk:ics55',
            display_name: 'ICS55',
            installed_version: '1.10.102',
            latest_version: '1.10.102',
            update_kind: 'rebuild',
          },
        ],
      },
    })
    expect(readResourceStalenessPayload(error)).toEqual({
      resources: [
        {
          id: 'tool:yosys',
          display_name: 'Yosys',
          installed_version: '1.0',
          latest_version: '1.1',
          update_kind: 'version',
        },
        {
          id: 'pdk:ics55',
          display_name: 'ICS55',
          installed_version: '1.10.102',
          latest_version: '1.10.102',
          update_kind: 'rebuild',
        },
      ],
    })
  })

  it('drops malformed items and normalizes missing fields', () => {
    const error = Object.assign(new Error('x'), {
      code: RESOURCE_UPDATE_AVAILABLE,
      details: {
        resources: [
          { id: 'tool:yosys' },
          { display_name: 'no id' },
          'garbage',
          { id: 'tool:slang', update_kind: 'unexpected' },
        ],
      },
    })
    expect(readResourceStalenessPayload(error)).toEqual({
      resources: [
        {
          id: 'tool:yosys',
          display_name: 'tool:yosys',
          installed_version: null,
          latest_version: null,
          update_kind: null,
        },
        {
          id: 'tool:slang',
          display_name: 'tool:slang',
          installed_version: null,
          latest_version: null,
          update_kind: null,
        },
      ],
    })
  })
})
