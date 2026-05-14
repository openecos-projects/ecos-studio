import { describe, expect, it } from 'vitest'
import type { FlowLogSegment } from '@/composables/useHomeData'
import {
  flowLogStepKey,
  getDefaultSelectedFlowLogKey,
  reconcileSelectedFlowLogKey,
  toFlowLogListItems,
} from './homeViewFlowLogSelection'

const segments: FlowLogSegment[] = [
  {
    stepName: 'Import',
    tool: 'python',
    state: 'Success',
    failed: false,
    missing: false,
  },
  {
    stepName: 'Synthesis',
    tool: 'yosys',
    state: 'Ongoing',
    failed: false,
    missing: false,
    live: true,
    truncated: true,
    totalSize: 4096,
  },
]

describe('homeViewFlowLogSelection', () => {
  it('prefers the live segment for the default selection', () => {
    expect(getDefaultSelectedFlowLogKey(segments)).toBe('Synthesis\u001fyosys')
  })

  it('falls back to the last segment when no live segment exists', () => {
    expect(getDefaultSelectedFlowLogKey([
      segments[0],
      {
        ...segments[1],
        live: false,
        state: 'Success',
      },
    ])).toBe('Synthesis\u001fyosys')
  })

  it('keeps a user-selected historical segment when it still exists', () => {
    expect(reconcileSelectedFlowLogKey(segments, 'Import\u001fpython')).toBe('Import\u001fpython')
  })

  it('prefers the live segment while a flow is running', () => {
    expect(reconcileSelectedFlowLogKey(segments, 'Import\u001fpython', { preferLive: true })).toBe(
      'Synthesis\u001fyosys',
    )
  })

  it('falls back to the default selection when the previous key disappears', () => {
    expect(reconcileSelectedFlowLogKey(segments, 'missing\u001fstep')).toBe('Synthesis\u001fyosys')
  })

  it('projects the minimal list item metadata for the step navigator', () => {
    expect(toFlowLogListItems(segments)).toEqual([
      {
        key: 'Import\u001fpython',
        stepName: 'Import',
        tool: 'python',
        state: 'Success',
        failed: false,
        live: false,
        truncated: false,
        missing: false,
        totalSize: undefined,
      },
      {
        key: 'Synthesis\u001fyosys',
        stepName: 'Synthesis',
        tool: 'yosys',
        state: 'Ongoing',
        failed: false,
        live: true,
        truncated: true,
        missing: false,
        totalSize: 4096,
      },
    ])
  })

  it('builds stable flow log keys', () => {
    expect(flowLogStepKey(segments[1]!)).toBe('Synthesis\u001fyosys')
  })
})
