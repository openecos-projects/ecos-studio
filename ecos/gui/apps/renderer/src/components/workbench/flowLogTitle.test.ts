import { describe, expect, it } from 'vitest'
import { formatFlowLogTitle, formatLiveRuntime } from './flowLogTitle'

describe('formatLiveRuntime', () => {
  it('formats elapsed milliseconds as HH:MM:SS', () => {
    expect(formatLiveRuntime(0)).toBe('00:00:00')
    expect(formatLiveRuntime(1_000)).toBe('00:00:01')
    expect(formatLiveRuntime(65_000)).toBe('00:01:05')
    expect(formatLiveRuntime(3_726_000)).toBe('01:02:06')
  })

  it('clamps negative elapsed time to zero', () => {
    expect(formatLiveRuntime(-500)).toBe('00:00:00')
  })
})

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

  it('falls back to the status node when the segment runtime is not loaded yet', () => {
    expect(
      formatFlowLogTitle(
        {
          stepName: 'Floorplan',
          tool: 'openroad',
          runtime: '',
          peakMemoryMb: undefined,
        },
        {
          id: '/workspace-a:floorplan',
          label: 'Floorplan',
          status: 'succeeded',
          runtime: '00:00:18',
          peakMemoryMb: 256,
        },
      ),
    ).toBe('Floorplan · openroad · Runtime 00:00:18 · Peak memory 256 MB')
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
