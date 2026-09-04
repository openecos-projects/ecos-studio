import type {
  EccEngineeringMetric,
  WorkspaceStaInsights,
  WorkspaceStepDetail,
} from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import { snapshotStepDashboardData } from './stepDashboardSnapshot'

function metric(id: string, value: number): EccEngineeringMetric {
  return {
    id,
    display_name: id,
    value,
    unit: 'count',
    category: 'clock_robustness_dfm',
    direction: 'lower_is_better',
    scope: 'workspace',
    corner: null,
    analysis_group: 'test',
    rating: { gate: false, score: false, trend: true },
    project_role: 'trend',
    step_role: 'primary',
    confidence: 'high',
    source: {},
  }
}

function detail(step: string): WorkspaceStepDetail {
  return {
    analysis: {
      metrics: [],
      summary: null,
      hotspots: [],
      drc: { totalCount: null, hotspots: [], reportedCount: 0, truncated: false },
      sta: null,
      congestion: [],
      database: null,
      lvs: null,
      rcx: null,
    },
    artifacts: [],
    checklist: { findings: [] },
    step: { stepId: step, order: 0, name: step, state: 'succeeded' },
    subflow: { status: 'available', steps: [] },
  }
}

describe('snapshotStepDashboardData', () => {
  it('keeps normalized DRC rule/layer detail visible', () => {
    const source = detail('DRC')
    source.analysis.metrics = [metric('drc_count', 12)]
    source.analysis.drc = {
      totalCount: 12,
      hotspots: [
        {
          metricId: 'drc:MinimumSpacing:M3',
          rule: 'MinimumSpacing',
          layer: 'M3',
          displayName: 'Minimum Spacing · M3',
          value: 12,
          unit: 'count',
        },
      ],
      reportedCount: 1,
      truncated: false,
    }

    const result = snapshotStepDashboardData(source)

    expect(result.stepBars).toEqual([
      expect.objectContaining({ id: 'drc_count', value: 12 }),
    ])
    expect(result.drcInsights).toMatchObject({
      table: {
        headers: ['Type', 'M3', 'total'],
        rows: [{ values: ['MinimumSpacing', '12', '12'] }],
      },
    })
  })

  it('keeps committed STA corners and critical paths visible', () => {
    const source = detail('STA')
    const sta: WorkspaceStaInsights = {
      corners: [
        {
          corner: 'TT',
          role: 'setup',
          process: 'tt',
          voltageV: 1.8,
          temperatureC: 25,
          rcCorner: 'typical',
          availability: 'available',
          setupWns: -0.2,
          setupTns: -1.2,
          setupViolationCount: 3,
          frequencyMhz: 750,
          holdWns: 0.1,
          holdTns: 0,
          holdViolationCount: 0,
        },
      ],
      criticalPaths: [
        {
          issueId: 'setup-main',
          corner: 'TT',
          analysisType: 'setup',
          slackNs: -0.2,
          startPoint: 'launch',
          endPoint: 'capture',
          pathGroup: 'core',
          stages: [{ pin: 'u_buf:Y', cell: 'BUFX3', arrivalNs: 1.2, delayNs: 0.12 }],
        },
      ],
      worstSetup: { corner: 'TT', wns: -0.2 },
      worstHold: { corner: 'TT', wns: 0.1 },
      frequencyMhz: 750,
      setupViolationCount: 3,
      holdViolationCount: 0,
      allCornersMet: false,
    }
    source.analysis.sta = sta

    const result = snapshotStepDashboardData(source)

    expect(result.staInsights?.corners).toHaveLength(1)
    expect(result.timingAnalysis).toMatchObject({
      overview: { worstSetup: { corner: 'TT', wns: -0.2 } },
      pathsByCorner: [{ corner: 'TT', paths: [{ id: 'setup-main' }] }],
    })
  })

  it('keeps bounded LVS tables visible without reading the feature file', () => {
    const source = detail('LVS')
    source.analysis.lvs = {
      entities: [
        {
          id: 'entity-1',
          entity: 'nets',
          netlist: 10,
          def: 9,
          difference: 1,
        },
      ],
      connections: [],
      violations: [
        {
          id: 'violation-1',
          type: 'open',
          net: 'n1',
          instance: '',
          terminals: 'A, B',
          components: '',
        },
      ],
    }

    expect(snapshotStepDashboardData(source).lvsInsights).toMatchObject({
      entities: [{ entity: 'nets', difference: 1 }],
      violations: [{ type: 'open', net: 'n1' }],
    })
  })

  it('keeps committed database compositions and distributions visible', () => {
    const source = detail('Floorplan')
    source.artifacts = [
      {
        artifactId: 'layout-floorplan',
        availability: 'missing',
        kind: 'layout_image',
        name: 'gcd_Floorplan.png',
        stepId: 'Floorplan',
      },
    ]
    source.analysis.database = {
      layout: {
        dieArea: 10000,
        dieUsage: 0.4,
        dieWidth: 100,
        dieHeight: 100,
        coreArea: 6400,
        coreUsage: 0.5,
        coreWidth: 80,
        coreHeight: 80,
        dbu: 1000,
      },
      statistics: { ioPins: 54, instances: 450, nets: 350, pdn: 0 },
      instanceClasses: [
        { kind: 'logic', count: 300, area: 600, pinCount: 900 },
        { kind: 'macros', count: 2, area: 200, pinCount: 20 },
      ],
      instanceTotal: { count: 450, area: 1000, pinCount: 1200 },
      pinDistribution: [
        { pinCount: 2, instanceCount: 10, netCount: 4 },
        { pinCount: 40, instanceCount: 2, netCount: 1 },
      ],
      cutLayers: [{ layer: 'VIA1', viaCount: 24 }],
      routingLayers: [{ layer: 'M3', wireLength: 120.5 }],
      wireLength: 120.5,
      viaCount: 24,
    }

    const result = snapshotStepDashboardData(source)

    expect(result.floorplanInsights?.snapshots.map((snapshot) => snapshot.label)).toEqual(
      [
        'Instance Area',
        'Instance Count',
        'Instance Pins',
        'Inst Pin Bins',
        'Net Pin Bins',
        'Cut Layer Vias',
        'Routing Wire Length',
      ],
    )
    expect(
      result.floorplanInsights?.snapshots
        .find((snapshot) => snapshot.label === 'Inst Pin Bins')
        ?.slices.find((slice) => slice.label === '>32')?.value,
    ).toBe(2)
    expect(result.designStatis?.groups[0]?.rows).toContainEqual({
      id: 'core-area',
      label: 'Core Area',
      value: '6400 um2',
    })
    expect(result.layoutAvailability).toBe('missing')
  })

  it('shows invalidated evidence from its stale Revision until rerun succeeds', () => {
    const source = detail('Place')
    source.step.state = 'not-started'
    source.staleEvidence = {
      ...detail('Place'),
      analysis: {
        ...detail('Place').analysis,
        metrics: [metric('place_hpwl', 1234)],
      },
      workspaceRevision: 4,
    }

    const stale = snapshotStepDashboardData(source)

    expect(stale.keyMetrics).toEqual([
      expect.objectContaining({ id: 'place_hpwl', value: 1234 }),
    ])
    expect(stale.run.state).not.toBe('Success')
    expect(stale.staleRevision).toBe(4)

    source.step.state = 'succeeded'
    expect(snapshotStepDashboardData(source).staleRevision).toBeNull()
  })
})
