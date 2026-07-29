import { describe, expect, it } from 'vitest'
import { buildProjectAnalysisSnapshot } from './projectAnalysisSnapshot'
import type { ProjectQorWorkspaceInput } from './projectQorTrend'

describe('ProjectAnalysisSnapshot', () => {
  it('preserves current V4 findings from summary, artifact, and STA timing analysis', () => {
    const snapshot = buildProjectAnalysisSnapshot(workspaceInput(), [
      'Place',
      'STA',
      'DRC',
    ])

    expect(snapshot.steps.Place).toMatchObject({
      artifactStatus: 'available',
      summaryArtifactStatus: 'available',
      hotspotArtifactStatus: 'missing',
      missingMetrics: [],
    })
    expect(snapshot.steps.DRC?.hardGateFailures).toEqual([
      expect.objectContaining({
        id: 'qor.drc.clean',
        metric: 'drc_count',
        threshold: 0,
        actual: 2,
        evidence: {
          sourceFile: 'feature/drc.step.json',
          sourceSelector: '/drc/number',
          expectedOperator: '==',
          expectedValue: 0,
          diagnosis: 'drc_count=2 (required == 0)',
          availability: null,
        },
      }),
    ])
    expect(snapshot.steps.STA).toMatchObject({
      timingIssues: [
        expect.objectContaining({
          issueId: 'setup-critical',
          corner: 'MAX_125/Cworst',
          slackNs: -0.032,
        }),
      ],
      timingCoverage: {
        missingCornerCount: 1,
        missingCorners: ['MIN_m40/Cbest'],
        availableArtifactCount: 0,
      },
    })
  })

  it('preserves structured RCX and STA detail descriptors from V3 artifacts', () => {
    const snapshot = buildProjectAnalysisSnapshot(workspaceInput(), ['RCX', 'STA'])

    expect(snapshot.steps.RCX?.details).toEqual([
      expect.objectContaining({
        id: 'rcx_electrical_corner_metrics',
        presentation: 'rcx_spef_corner_table',
        summary: {
          coverage: { status: 'pass', expected_count: 9, available_count: 9 },
        },
        sourceFile: 'feature/RCX.step.json',
        selector: '/rcx/signoff_metrics',
      }),
    ])
    expect(snapshot.steps.STA?.details).toEqual([
      expect.objectContaining({
        id: 'sta_path_group_metrics',
        presentation: 'path_group_table',
        summary: expect.objectContaining({
          records: expect.arrayContaining([
            expect.objectContaining({ path_group: 'group_01' }),
          ]),
        }),
        sourceFile: 'feature/sta.step.json',
        selector: '/timing/path_groups',
      }),
    ])
    expect(snapshot.steps.STA?.details[0]?.summary.records).toHaveLength(13)
  })
})

function workspaceInput(): ProjectQorWorkspaceInput {
  return {
    workspaceId: 'ws_0004',
    workspaceName: 'ws_0004',
    workspacePath: '/projects/gcd/ws_0004',
    createdAt: '2026-07-21T00:00:00.000Z',
    status: 'success',
    branchFrom: null,
    stepMetricTexts: {
      Place: metricsArtifact('place'),
      RCX: metricsArtifact('RCX'),
      STA: metricsArtifact('sta'),
      DRC: metricsArtifact('drc'),
    },
    stepSummaryTexts: {
      Place: JSON.stringify({
        schema_version: 4,
        analysis_status: 'valid',
        quality_status: 'pass',
        gates: [],
        missing_metrics: [],
      }),
      STA: JSON.stringify({
        schema_version: 4,
        analysis_status: 'valid',
        quality_status: 'incomplete',
        gates: [
          {
            id: 'qor.sta.setup_closed',
            title: 'STA setup closure',
            state: 'unavailable',
            blocking: true,
            metrics: [],
            evidence: [],
          },
        ],
        missing_metrics: [],
      }),
      DRC: JSON.stringify({
        schema_version: 4,
        analysis_status: 'valid',
        quality_status: 'blocked',
        missing_metrics: [],
        gates: [
          {
            id: 'qor.drc.clean',
            title: 'Final DRC clean',
            state: 'failed',
            blocking: true,
            metrics: [{ id: 'drc_count', actual: 2, operator: '==', expected: 0 }],
            evidence: [
              { kind: 'feature', path: 'feature/drc.step.json', selector: '/drc/number' },
            ],
          },
        ],
      }),
    },
    stepHotspotTexts: {
      STA: JSON.stringify({ schema_version: 3, hotspots: [] }),
      DRC: JSON.stringify({ schema_version: 3, hotspots: [] }),
    },
    staTimingIssuesText: JSON.stringify({
      schema_version: 1,
      near_fail_slack_ns: 0.05,
      missing_corners: ['MIN_m40/Cbest'],
      issues: [
        {
          issue_id: 'setup-critical',
          severity: 'critical',
          analysis_type: 'setup',
          corner: 'MAX_125/Cworst',
          path_group: 'clk',
          check_type: 'setup',
          slack_ns: -0.032,
        },
      ],
      artifact_paths: [],
    }),
    stepStatuses: { Place: 'success', STA: 'success', DRC: 'success' },
  }
}

function metricsArtifact(step: string): string {
  const details =
    step === 'RCX'
      ? [
          {
            id: 'rcx_electrical_corner_metrics',
            presentation: 'rcx_spef_corner_table',
            summary: {
              coverage: { status: 'pass', expected_count: 9, available_count: 9 },
            },
            feature_source: {
              kind: 'feature',
              path: 'feature/RCX.step.json',
              selector: '/rcx/signoff_metrics',
            },
          },
        ]
      : step === 'sta'
        ? [
            {
              id: 'sta_path_group_metrics',
              presentation: 'path_group_table',
              summary: {
                records: Array.from({ length: 13 }, (_, index) => ({
                  path_group: `group_${String(index + 1).padStart(2, '0')}`,
                })),
              },
              feature_source: {
                kind: 'feature',
                path: 'feature/sta.step.json',
                selector: '/timing/path_groups',
              },
            },
          ]
        : []

  return JSON.stringify({
    schema_version: 3,
    step,
    integrity: {
      status: 'pass',
      invalid_metric_source_ids: [],
      invalid_detail_ids: [],
    },
    metrics: [
      {
        id: `${step}_metric`,
        display_name: `${step} metric`,
        value: 1,
        unit: 'count',
        category: 'routability_physical',
        direction: 'lower_is_better',
        scope: 'design',
        corner: null,
        project_role: 'final',
        step_role: 'primary',
        confidence: 'high',
        analysis_group: 'test',
        rating: { gate: false, score: false, trend: true },
        source: { kind: 'feature', path: 'feature/step.json', selector: '/metric' },
      },
    ],
    details,
  })
}
