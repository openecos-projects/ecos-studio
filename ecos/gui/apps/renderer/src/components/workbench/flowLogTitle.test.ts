import { describe, expect, it } from 'vitest'
import { formatFlowLogTitle } from './flowLogTitle'

describe('formatFlowLogTitle', () => {
  it('uses the active workspace flow record over a stale status node', () => {
    expect(
      formatFlowLogTitle(
        {
          stepName: 'Floorplan',
          tool: 'openroad',
          runtime: '00:03:24',
          peakMemoryMb: 2048,
        },
        {
          id: '/workspace-a:floorplan',
          label: 'Floorplan',
          status: 'succeeded',
          runtime: '00:00:18',
          peakMemoryMb: 256,
        },
      ),
    ).toBe('Floorplan · openroad · Runtime 00:03:24 · Peak memory 2.0 GB')
  })

  it('uses the status node while the selected workspace log is unavailable', () => {
    expect(
      formatFlowLogTitle(null, {
        id: '/workspace-a:synthesis',
        label: 'Synthesis',
        status: 'running',
        runtime: '00:00:42',
        peakMemoryMb: 768,
      }),
    ).toBe('Synthesis · Runtime 00:00:42 · Peak memory 768 MB')
  })
})
