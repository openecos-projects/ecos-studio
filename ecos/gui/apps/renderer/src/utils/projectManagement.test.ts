import { describe, expect, it } from 'vitest'
import {
  FLOW_STEPS,
  buildProjectManagementProject,
  createProjectManifestDraft,
  createSelectionState,
  parseWorkspaceFlowStateMap,
  registerWorkspaceInManifest,
  setQorBaselineInManifest,
  type FlowStep,
} from './projectManagement'
import type { Project } from '@/types'

const project: Project = {
  id: '/projects/gcd',
  name: 'gcd',
  path: '/projects/gcd',
  lastOpened: new Date('2026-07-20T00:00:00Z'),
  status: 'success',
  totalSteps: 12,
  completedSteps: 12,
}

const successStates = Object.fromEntries(
  FLOW_STEPS.map((step) => [step, 'success']),
) as Partial<Record<FlowStep, 'success'>>

function metric(id: string, value: number, overrides: Record<string, unknown> = {}) {
  const timing = id.startsWith('sta_')
  return {
    id,
    display_name: id.replace(/_/g, ' '),
    value,
    unit: timing ? 'ns' : 'count',
    category: timing ? 'timing' : 'routability_physical',
    direction:
      id.includes('wns') || id.includes('tns') || id.includes('frequency')
        ? 'higher_is_better'
        : id.includes('count') || id.includes('drc') || id.includes('wirelength')
          ? 'lower_is_better'
          : 'trend_only',
    scope: 'design',
    corner: null,
    project_role: timing ? 'gate' : 'final',
    step_role: 'primary',
    confidence: 'high',
    analysis_group: 'test_metrics',
    rating: { gate: timing, score: timing, trend: true },
    source: { kind: 'feature', path: 'feature/test.step.json', selector: '/test' },
    ...overrides,
  }
}

function metricsArtifact(step: string, metrics: Record<string, unknown>[]) {
  return JSON.stringify({
    schema_version: 3,
    tool: 'ecc',
    step,
    status: 'success',
    metrics,
    details: [],
    sources: [{ kind: 'feature', path: 'feature/test.step.json' }],
    integrity: {
      status: 'pass',
      invalid_metric_source_ids: [],
      invalid_detail_ids: [],
    },
  })
}

function summaryArtifact(
  status: 'pass' | 'blocked' | 'incomplete' | 'unavailable',
  readiness?: Record<string, unknown>,
) {
  return JSON.stringify({
    schema_version: 3,
    status,
    blocking_issues: [],
    missing_metrics: [],
    ...(readiness ? { signoff_readiness: readiness } : {}),
  })
}

function passingReadiness(groups: Array<{ id: string; gate: boolean }>) {
  return {
    status: 'pass',
    score_eligible: true,
    reason_codes: [],
    groups: groups.map((group) => ({ ...group, status: 'pass' })),
    ocv: { status: 'unavailable' },
  }
}

function manifestWithWorkspace(workspaceId = 'ws_0004') {
  return registerWorkspaceInManifest(
    createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-20T00:00:00.000Z',
    }),
    {
      projectRoot: '/projects/gcd',
      workspacePath: `/projects/gcd/${workspaceId}`,
      startStep: 'Synth',
      endStep: 'Harden',
      now: '2026-07-20T00:00:00.000Z',
    },
  )
}

function v3Inputs(readinessStatus: 'pass' | 'incomplete' = 'pass') {
  const staCorner = {
    configured_role: 'MAX',
    process_corner: 'SS',
    voltage_v: 1.08,
    temperature_c: 125,
    rc_corner: 'Cworst',
    label: 'MAX - SS - 1.08 V - 125 C - Cworst',
  }
  return {
    stepMetricTexts: {
      Route: metricsArtifact('route', [
        metric('route_wirelength', 5200, {
          unit: 'um',
          rating: { gate: false, score: true, trend: true },
        }),
        metric('runtime_seconds', 12.5, {
          unit: 's',
          project_role: 'trend',
          step_role: 'secondary',
          rating: { gate: false, score: false, trend: true },
        }),
      ]),
      DRC: metricsArtifact('drc', [metric('drc_count', 0)]),
      RCX: metricsArtifact('RCX', [
        metric('rcx_missing_corner_count', 0, {
          category: 'clock_robustness_dfm',
          rating: { gate: true, score: false, trend: true },
        }),
        metric('peak_memory_mb', 256, {
          unit: 'MB',
          project_role: 'trend',
          step_role: 'secondary',
          rating: { gate: false, score: false, trend: true },
        }),
      ]),
      STA: metricsArtifact('sta', [
        metric('sta_setup_wns', 2.905, {
          corner: 'MAX_125/Cworst',
          corner_context: staCorner,
        }),
        metric('sta_setup_tns', 0, {
          corner: 'MAX_125/Cworst',
          corner_context: staCorner,
        }),
        metric('sta_hold_wns', 0.099, {
          corner: 'MIN_m40/Cbest',
          corner_context: {
            ...staCorner,
            configured_role: 'MIN',
            process_corner: 'FF',
            voltage_v: 1.32,
            temperature_c: -40,
            rc_corner: 'Cbest',
            label: 'MIN - FF - 1.32 V - -40 C - Cbest',
          },
        }),
        metric('sta_hold_tns', 0, { corner: 'MIN_m40/Cbest', corner_context: staCorner }),
        metric('sta_frequency_mhz', 477, {
          unit: 'MHz',
          corner: 'MAX_125/Cworst',
          corner_context: staCorner,
          project_role: 'final',
          rating: { gate: false, score: true, trend: true },
        }),
      ]),
      Harden: metricsArtifact('Harden', [
        metric('core_area', 1200, {
          unit: 'um2',
          category: 'area_cost',
          direction: 'lower_is_better',
          rating: { gate: false, score: true, trend: true },
        }),
        metric('die_area', 2400, {
          unit: 'um2',
          category: 'area_cost',
          direction: 'lower_is_better',
          rating: { gate: false, score: true, trend: true },
        }),
        metric('core_utilization', 0.62, {
          unit: 'ratio',
          category: 'area_cost',
          direction: 'target_range',
          rating: { gate: false, score: true, trend: true },
        }),
      ]),
    },
    stepSummaryTexts: {
      Route: summaryArtifact('pass'),
      DRC: summaryArtifact('pass'),
      RCX: summaryArtifact(
        readinessStatus,
        readinessStatus === 'pass'
          ? passingReadiness([
              { id: 'rcx_corner_coverage', gate: true },
              { id: 'rcx_parse_health', gate: true },
            ])
          : {
              status: 'incomplete',
              score_eligible: false,
              reason_codes: ['rcx_corner_missing'],
              groups: [{ id: 'rcx_corner_coverage', status: 'incomplete', gate: true }],
            },
      ),
      STA: summaryArtifact(
        'pass',
        passingReadiness([
          { id: 'sta_signoff_coverage', gate: true },
          { id: 'sta_setup_closure', gate: true },
          { id: 'sta_hold_closure', gate: true },
        ]),
      ),
      Harden: summaryArtifact('pass'),
    },
    stepHotspotTexts: {},
    staTimingIssuesText: JSON.stringify({
      schema_version: 1,
      near_fail_slack_ns: 0.05,
      missing_corners: [],
      issues: [],
    }),
  }
}

describe('project management V3 model', () => {
  it('uses the fixed project flow step order', () => {
    expect(FLOW_STEPS).toEqual([
      'Synth',
      'Floor',
      'Fanout',
      'Place',
      'CTS',
      'Legal',
      'Route',
      'DRC',
      'Filler',
      'RCX',
      'STA',
      'Harden',
    ])
  })

  it('builds an empty model without manufacturing metric rows', () => {
    const model = buildProjectManagementProject(project, null)
    expect(model.workspaces).toEqual([])
    expect(model.metricsRows).toEqual([])
    expect(createSelectionState(model).selectedWorkspaceId).toBe('')
  })

  it('derives dashboard keys and Step Analysis from schema v3 metric ids', () => {
    const manifest = manifestWithWorkspace()
    const model = buildProjectManagementProject(
      project,
      manifest,
      { ws_0004: successStates },
      { ws_0004: v3Inputs() },
    )

    const summary = model.workspaceSummaries[0]!
    expect(summary.finalMetrics.setupWns).toMatchObject({ value: 2.905 })
    expect(summary.finalMetrics.setupWns?.hint).toContain(
      'MAX - SS - 1.08 V - 125 C - Cworst',
    )
    expect(summary.flowMetrics).toMatchObject({
      totalRuntimeSec: 12.5,
      peakMemoryMb: 256,
    })
    expect(model.metricsRows.find((row) => row.id === 'drc')?.points[0]).toMatchObject({
      value: 0,
      state: 'good',
    })
    expect(
      model.stepCompareSummaries.find((item) => item.step === 'Route')?.metrics,
    ).toEqual([
      expect.objectContaining({ id: 'route_wirelength' }),
      expect.objectContaining({ id: 'runtime_seconds' }),
    ])
    expect(
      summary.analysis.steps.STA?.metrics.find(
        (item) => item.metricName === 'sta_setup_wns',
      )?.cornerContext?.label,
    ).toBe('MAX - SS - 1.08 V - 125 C - Cworst')
  })

  it('marks a workspace not rated when RCX or STA signoff readiness is incomplete', () => {
    const manifest = manifestWithWorkspace()
    const model = buildProjectManagementProject(
      project,
      manifest,
      { ws_0004: successStates },
      { ws_0004: v3Inputs('incomplete') },
    )

    expect(model.qorTrendSummary.workspaces[0]).toMatchObject({
      overallScore: null,
      signoffReadiness: { status: 'incomplete', scoreEligible: false },
    })
  })

  it('uses flow.json only for execution state', () => {
    expect(
      parseWorkspaceFlowStateMap(
        JSON.stringify({
          steps: [
            { name: 'route', state: 'running' },
            { name: 'sta', state: 'success' },
          ],
        }),
      ),
    ).toEqual({ Route: 'running', STA: 'success' })
  })

  it('keeps baseline selection as project metadata without manifest metrics', () => {
    const manifest = manifestWithWorkspace()
    const updated = setQorBaselineInManifest(manifest, 'ws_0004')
    expect(updated.qor_baseline).toEqual({
      workspace_id: 'ws_0004',
      reason: 'Selected from Project QoR Trend',
    })
    expect(updated.workspaces[0]).not.toHaveProperty('metrics_summary')
    expect(updated.workspaces[0]).not.toHaveProperty('step_metrics')
  })
})
