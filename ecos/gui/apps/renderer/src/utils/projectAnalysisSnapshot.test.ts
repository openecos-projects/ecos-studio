import { describe, expect, it } from 'vitest'
import { buildProjectAnalysisSnapshot } from './projectAnalysisSnapshot'
import type { ProjectQorWorkspaceInput } from './projectQorTrend'

describe('ProjectAnalysisSnapshot', () => {
  it('preserves current V3 findings from summary, artifact, and STA timing analysis', () => {
    const snapshot = buildProjectAnalysisSnapshot(workspaceInput(), [
      'Place',
      'STA',
      'Harden',
    ])

    expect(snapshot.steps.Place).toMatchObject({
      artifactStatus: 'available',
      summaryArtifactStatus: 'available',
      hotspotArtifactStatus: 'missing',
      missingMetrics: [],
    })
    expect(snapshot.steps.Harden?.hardGateFailures).toEqual([
      expect.objectContaining({
        id: 'final_package_complete',
        metric: 'harden_artifact_missing_count',
        threshold: 0,
        actual: 2,
        evidence: {
          sourceFile: 'feature/Harden.step.json',
          sourceSelector: '/harden/artifact_missing_count',
          expectedOperator: '==',
          expectedValue: 0,
          diagnosis:
            'Observed harden_artifact_missing_count = 2; required condition is == 0.',
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
      STA: metricsArtifact('sta'),
      Harden: metricsArtifact('Harden'),
    },
    stepSummaryTexts: {
      Place: JSON.stringify({
        schema_version: 3,
        status: 'pass',
        blocking_issues: [],
        hard_gates: [],
        missing_metrics: [],
      }),
      STA: JSON.stringify({
        schema_version: 3,
        status: 'incomplete',
        blocking_issues: [],
        hard_gates: [],
        missing_metrics: [],
        signoff_readiness: {
          status: 'incomplete',
          score_eligible: false,
          reason_codes: ['sta_corner_missing'],
          groups: [{ id: 'sta_signoff_coverage', status: 'incomplete', gate: true }],
        },
      }),
      Harden: JSON.stringify({
        schema_version: 3,
        status: 'blocked',
        blocking_issues: [],
        missing_metrics: [],
        hard_gates: [
          {
            id: 'final_package_complete',
            passed: false,
            metric: 'harden_artifact_missing_count',
            threshold: 0,
            actual: 2,
            evidence: {
              source: {
                kind: 'feature',
                path: 'feature/Harden.step.json',
                selector: '/harden/artifact_missing_count',
              },
              expected: { operator: '==', value: 0 },
              diagnosis:
                'Observed harden_artifact_missing_count = 2; required condition is == 0.',
            },
          },
        ],
      }),
    },
    stepHotspotTexts: {
      STA: JSON.stringify({ schema_version: 3, hotspots: [] }),
      Harden: JSON.stringify({ schema_version: 3, hotspots: [] }),
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
    stepStatuses: { Place: 'success', STA: 'success', Harden: 'success' },
  }
}

function metricsArtifact(step: string): string {
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
    details: [],
  })
}
