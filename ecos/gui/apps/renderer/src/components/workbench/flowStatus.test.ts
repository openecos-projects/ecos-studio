import { describe, expect, it } from 'vitest'
import {
  flowNodeStatus,
  flowStatusSummary,
  formatPeakMemory,
  initialSelectedNodeId,
  nextFlowNodeSelection,
  runningFlowNodeId,
  type FlowStatusNode,
} from './flowStatus'

describe('flow status presentation', () => {
  it('normalizes workspace and subflow state names', () => {
    expect(flowNodeStatus('Success')).toBe('succeeded')
    expect(flowNodeStatus('Ongoing')).toBe('running')
    expect(flowNodeStatus('Invalid')).toBe('failed')
    expect(flowNodeStatus('Unstart')).toBe('queued')
  })

  it('summarizes every visible node without dropping compact states', () => {
    const nodes: FlowStatusNode[] = [
      { id: 'a', label: 'A', status: 'succeeded', runtime: '', peakMemoryMb: null },
      { id: 'b', label: 'B', status: 'running', runtime: '', peakMemoryMb: null },
      { id: 'c', label: 'C', status: 'failed', runtime: '', peakMemoryMb: null },
      { id: 'd', label: 'D', status: 'queued', runtime: '', peakMemoryMb: null },
      { id: 'e', label: 'E', status: 'skipped', runtime: '', peakMemoryMb: null },
    ]

    expect(flowStatusSummary(nodes)).toEqual({
      queued: 1,
      running: 1,
      succeeded: 1,
      failed: 1,
      skipped: 1,
    })
    expect(initialSelectedNodeId(nodes)).toBe('b')
    expect(runningFlowNodeId(nodes)).toBe('b')
    expect(runningFlowNodeId([{ ...nodes[0]!, status: 'succeeded' }])).toBeNull()
  })

  it('follows a newly running step without overriding a manual log selection mid-step', () => {
    const synthesis = {
      id: 'synthesis',
      label: 'Synthesis',
      status: 'running' as const,
      runtime: '',
      peakMemoryMb: null,
    }
    const floorplan = {
      id: 'floorplan',
      label: 'Floorplan',
      status: 'queued' as const,
      runtime: '',
      peakMemoryMb: null,
    }

    expect(nextFlowNodeSelection([synthesis, floorplan], 'floorplan', 'synthesis')).toEqual({
      runningNodeId: 'synthesis',
      selectedNodeId: 'floorplan',
    })
    expect(
      nextFlowNodeSelection(
        [{ ...synthesis, status: 'succeeded' }, { ...floorplan, status: 'running' }],
        'synthesis',
        'synthesis',
      ),
    ).toEqual({
      runningNodeId: 'floorplan',
      selectedNodeId: 'floorplan',
    })
  })

  it('formats memory without inventing a missing value', () => {
    expect(formatPeakMemory(null)).toBe('--')
    expect(formatPeakMemory(768)).toBe('768 MB')
    expect(formatPeakMemory(2048)).toBe('2.0 GB')
  })
})
