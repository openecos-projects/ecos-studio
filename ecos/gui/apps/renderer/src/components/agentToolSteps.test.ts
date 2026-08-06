import { describe, expect, it } from 'vitest'
import {
  EARLIER_COLLAPSE_THRESHOLD,
  buildAgentToolSteps,
  splitToolSteps,
} from './agentToolSteps'

describe('agentToolSteps', () => {
  it('turns newline progress into a running timeline', () => {
    const steps = buildAgentToolSteps(
      'Codex is analyzing the bounded request.\nCodex request accepted; waiting for read-only activity.\n',
      'loading',
    )
    expect(steps).toHaveLength(2)
    expect(steps[0]?.status).toBe('done')
    expect(steps[1]?.status).toBe('running')
    expect(steps[1]?.summary).toContain('Codex request accepted')
  })

  it('collapses Running/Completed flow lines and demotes artifact paths', () => {
    const steps = buildAgentToolSteps(
      [
        'Running sta.',
        'Completed sta. Saved: /home/ekko/runs/sta_opensta/output/gcd_sta.rpt; /home/ekko/runs/sta_opensta/output/gcd.sdc',
        'Running Harden.',
        'Completed Harden. Saved: /home/ekko/runs/Harden_yosys/output/gcd_harden.v',
      ].join('\n'),
      'done',
    )

    expect(steps.map((step) => step.summary)).toEqual(['sta', 'Harden'])
    expect(steps.every((step) => step.status === 'done')).toBe(true)
    expect(steps[0]?.detailLines).toEqual(['gcd_sta.rpt', 'gcd.sdc'])
    expect(steps[1]?.detailLines).toEqual(['gcd_harden.v'])
  })

  it('attaches subflow lines under the active stage instead of listing artifacts', () => {
    const steps = buildAgentToolSteps(
      [
        'Running place.',
        'place › load data',
        'place › run placement',
        'place › save data',
        'place › analysis',
        'Completed place.',
      ].join('\n'),
      'loading',
    )

    expect(steps).toEqual([
      {
        id: 'tool-0',
        summary: 'place',
        status: 'done',
        detailLines: ['load data', 'run placement', 'save data', 'analysis'],
      },
    ])
  })

  it('keeps the active flow step running until Completed arrives', () => {
    const steps = buildAgentToolSteps(
      'Preparing isolated rerun workspace.\nRunning place.\nplace › load data\n',
      'loading',
    )
    expect(steps).toEqual([
      {
        id: 'tool-0',
        summary: 'Preparing isolated rerun workspace',
        status: 'done',
      },
      {
        id: 'tool-1',
        summary: 'place',
        status: 'running',
        detailLines: ['load data'],
      },
    ])
  })

  it('splits older steps once the collapse threshold is exceeded', () => {
    const steps = buildAgentToolSteps(
      Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`).join('\n'),
      'loading',
    )
    const { earlier, recent } = splitToolSteps(steps)
    expect(earlier.length).toBeGreaterThan(0)
    expect(recent.length).toBeGreaterThanOrEqual(3)
    expect(earlier.length + recent.length).toBe(10)
    expect(steps.length).toBeGreaterThan(EARLIER_COLLAPSE_THRESHOLD)
  })
})
