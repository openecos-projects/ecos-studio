import { describe, expect, it } from 'vitest'
import {
  canSubmitTopModule,
  exclusiveDesignFilesReady,
  exclusiveRtlFilelistPrefill,
  nextTopModuleSelection,
  orderTopModuleCandidates,
} from './topModuleConfirmation'

describe('top module confirmation helpers', () => {
  it('prefills filelist only when both RTL and filelist defaults exist', () => {
    expect(exclusiveRtlFilelistPrefill(['/rtl/top.v'], '/design/sources.f')).toEqual({
      filelist: '/design/sources.f',
      rtlList: [],
    })
  })

  it('rejects leaving Design Files with both RTL and filelist', () => {
    expect(exclusiveDesignFilesReady(['/rtl/top.v'], '/design/sources.f')).toBe(false)
    expect(exclusiveDesignFilesReady(['/rtl/top.v'], '')).toBe(true)
    expect(exclusiveDesignFilesReady([], '/design/sources.f')).toBe(true)
    expect(exclusiveDesignFilesReady([], '')).toBe(false)
  })

  it('lists the suggested candidate first', () => {
    expect(orderTopModuleCandidates(['child', 'gcd_top'], 'gcd_top')).toEqual([
      'gcd_top',
      'child',
    ])
  })

  it('keeps a still-valid selection after path changes and otherwise uses the new heuristic', () => {
    expect(
      nextTopModuleSelection({
        currentValue: 'gcd_top',
        designNameChanged: false,
        pathsChanged: true,
        previousSuggested: 'gcd_top',
        result: {
          candidates: ['gcd_top', 'other'],
          status: 'complete',
          suggested: 'other',
        },
        seenDropdown: true,
        userPickedOther: true,
      }),
    ).toBe('gcd_top')
    expect(
      nextTopModuleSelection({
        currentValue: 'gone',
        designNameChanged: false,
        pathsChanged: true,
        previousSuggested: 'gone',
        result: {
          candidates: ['fresh'],
          status: 'complete',
          suggested: 'fresh',
        },
        seenDropdown: true,
        userPickedOther: false,
      }),
    ).toBe('fresh')
  })

  it('updates the suggested default when only Design Name changes', () => {
    expect(
      nextTopModuleSelection({
        currentValue: 'old',
        designNameChanged: true,
        pathsChanged: false,
        previousSuggested: 'old',
        result: {
          candidates: ['old', 'new'],
          status: 'complete',
          suggested: 'new',
        },
        seenDropdown: true,
        userPickedOther: false,
      }),
    ).toBe('new')
    expect(
      nextTopModuleSelection({
        currentValue: 'child',
        designNameChanged: true,
        pathsChanged: false,
        previousSuggested: 'old',
        result: {
          candidates: ['old', 'child', 'new'],
          status: 'complete',
          suggested: 'new',
        },
        seenDropdown: true,
        userPickedOther: true,
      }),
    ).toBe('child')
  })

  it('submits list names on complete discovery and identifiers only on escape hatches', () => {
    expect(
      canSubmitTopModule(
        { candidates: ['gcd_top'], status: 'complete', suggested: 'gcd_top' },
        'LUT4A',
      ),
    ).toBe(false)
    expect(
      canSubmitTopModule(
        { candidates: ['gcd_top'], status: 'complete', suggested: 'gcd_top' },
        'gcd_top',
      ),
    ).toBe(true)
    expect(
      canSubmitTopModule(
        {
          candidates: [],
          reason: 'too large',
          status: 'incomplete',
          suggested: '',
        },
        'manual_top',
      ),
    ).toBe(true)
    expect(
      canSubmitTopModule(
        {
          candidates: [],
          reason: 'unreadable',
          status: 'total_read_failure',
          suggested: '',
        },
        'not a name',
      ),
    ).toBe(false)
    expect(
      canSubmitTopModule(
        {
          candidates: [],
          reason: 'partial',
          status: 'partial_read_failure',
          suggested: '',
        },
        'manual_top',
      ),
    ).toBe(false)
  })
})
