import {
  compareSummaryFixture,
  trendSummaryFixture,
  workspaceSummaryFixture,
} from '@/components/projectStepAnalysis.fixture'
import type {
  FlowStep,
  ProjectDashboardSummary,
  ProjectManagementProject,
  ProjectMetricId,
  ProjectMetricPoint,
  ProjectMetricRow,
  ProjectStepStatus,
  ProjectWorkspace,
} from '@/utils/projectManagement'
import type { ProjectQorTrendSummary } from '@/utils/projectQorTrend'

export function metricPointFixture(
  workspaceId: string,
  value: number | null,
  label = value === null ? 'N/A' : String(value),
): ProjectMetricPoint {
  return {
    workspaceId,
    workspaceName: workspaceId,
    value,
    label,
    state: value === null ? 'pending' : 'good',
  }
}

export function metricRowFixture(
  id: ProjectMetricId,
  label: string,
  points: ProjectMetricPoint[],
): ProjectMetricRow {
  return { id, label, hint: `${label} hint`, kind: 'bar', points }
}

export function workspaceFixture(
  id: string,
  overrides: Partial<ProjectWorkspace> = {},
): ProjectWorkspace {
  const stepStatuses: ProjectStepStatus[] = ['success', 'success', 'failed', 'unstart']
  return {
    id,
    name: id,
    workspacePath: `/projects/demo/${id}`,
    artifactDesignName: 'aes',
    status: 'success',
    description: '',
    sourceWorkspaceId: null,
    branchStep: null,
    startStep: 'Synth',
    endStep: 'STA',
    depth: 0,
    flowStatusHint: { state: 'success', label: 'Success' },
    steps: (['Synth', 'Floor', 'Place', 'Route'] as FlowStep[]).map((step, index) => ({
      step,
      status: stepStatuses[index],
      label: step,
      canCreateWorkspace: false,
    })),
    ...overrides,
  }
}

export function dashboardSummaryFixture(
  overrides: Partial<ProjectDashboardSummary> = {},
): ProjectDashboardSummary {
  return {
    workspaceCount: 3,
    flowCompleteWorkspaceCount: 2,
    configuredStepCount: 12,
    successStepCount: 8,
    failedStepCount: 2,
    runningStepCount: 1,
    flowSuccessRatio: 8 / 12,
    drcCleanCount: 2,
    timingCleanCount: 1,
    timingAtRiskCount: 1,
    timingIncompleteCount: 1,
    timingUnavailableCount: 0,
    signoffReadyCount: 3,
    runStateSlices: [
      { state: 'success', label: 'Success', count: 2, percent: 66.7 },
      { state: 'failed', label: 'Failed', count: 1, percent: 33.3 },
    ],
    flowMetricSummary: {
      totalRuntimeSec: 0,
      peakMemoryMb: 0,
      checklistPassed: 0,
      checklistFailed: 0,
      checklistWarning: 0,
      checklistTotal: 0,
      runtimePoints: [
        metricPointFixture('ws_a', 320, '320 s'),
        metricPointFixture('ws_b', 280, '280 s'),
      ],
      memoryPoints: [
        metricPointFixture('ws_a', 1024, '1024 MB'),
        metricPointFixture('ws_b', 980, '980 MB'),
      ],
    },
    ...overrides,
  }
}

/** Baseline ws_a, top-scoring ws_b, and unrated ws_c so ranking paths are exercised. */
export function trendSummaryWithScoresFixture(): ProjectQorTrendSummary {
  const summary = trendSummaryFixture(
    [{ workspaceId: 'ws_a' }, { workspaceId: 'ws_b' }, { workspaceId: 'ws_c' }],
    'ws_a',
  )
  const scores: Record<string, number | null> = { ws_a: 58.4, ws_b: 74.2, ws_c: null }

  return {
    ...summary,
    baselineLabel: 'ws_a',
    workspaces: summary.workspaces.map((workspace) => ({
      ...workspace,
      overallScore: scores[workspace.workspaceId] ?? null,
      signoffReadiness: {
        ...workspace.signoffReadiness,
        status: workspace.workspaceId === 'ws_c' ? 'incomplete' : 'pass',
      },
    })),
    trendPoints: summary.workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      label: workspace.workspaceId,
      score: scores[workspace.workspaceId] ?? null,
      status: workspace.status,
    })),
    risks: [
      {
        workspaceId: 'ws_b',
        workspaceName: 'ws_b',
        step: 'STA',
        kind: 'blocking_issue',
        severity: 'critical',
        metric: 'setup_wns',
        displayName: 'Setup WNS',
        value: -0.42,
        message: 'Setup WNS is -0.42 ns against a 0 ns target.',
      },
      {
        workspaceId: 'ws_a',
        workspaceName: 'ws_a',
        step: 'DRC',
        kind: 'hotspot',
        severity: 'warning',
        metric: 'drc_count',
        displayName: 'DRC violations',
        value: 12,
        message: 'DRC reports 12 violations concentrated in the macro channel.',
      },
    ],
    regressions: [
      {
        workspaceId: 'ws_b',
        workspaceName: 'ws_b',
        baselineWorkspaceId: 'ws_a',
        baselineWorkspaceName: 'ws_a',
        metricName: 'die_area',
        displayName: 'Die area',
        currentValue: 900,
        baselineValue: 820,
        absoluteDelta: 80,
        relativeDeltaPct: 9.8,
        state: 'regression',
        message: 'Die area grew 9.8% against ws_a.',
      },
    ],
  }
}

export function projectFixture(
  overrides: Partial<ProjectManagementProject> = {},
): ProjectManagementProject {
  const qorTrendSummary = overrides.qorTrendSummary ?? trendSummaryWithScoresFixture()

  return {
    id: 'demo',
    projectType: 'backend',
    name: 'demo',
    path: '/projects/demo',
    pdk: 'sky130A',
    topModule: 'aes',
    objective: 'Close timing at 125 MHz',
    bestWorkspaceId: 'ws_b',
    workspaces: [
      workspaceFixture('ws_a'),
      workspaceFixture('ws_b', { status: 'running' }),
      workspaceFixture('ws_c', { status: 'not_started' }),
    ],
    metricsRows: [
      metricRowFixture('die_area', 'Die Area', [
        metricPointFixture('ws_a', 820, '820 um2'),
        metricPointFixture('ws_b', 900, '900 um2'),
      ]),
      metricRowFixture('core_util', 'Core Util', [
        metricPointFixture('ws_a', 0.7, '70%'),
        metricPointFixture('ws_b', 0.68, '68%'),
      ]),
      metricRowFixture('frequency', 'Frequency [MHz]', [
        metricPointFixture('ws_a', 100, '100 MHz'),
        metricPointFixture('ws_b', 150, '150 MHz'),
      ]),
      metricRowFixture('wns', 'WNS', [
        metricPointFixture('ws_a', 0.08, '0.08 ns'),
        metricPointFixture('ws_b', -0.42, '-0.42 ns'),
      ]),
      metricRowFixture('drc', 'DRC', [
        metricPointFixture('ws_a', 12, '12'),
        metricPointFixture('ws_b', 0, '0'),
      ]),
      metricRowFixture('lvs', 'LVS', [
        metricPointFixture('ws_a', 0, '0'),
        metricPointFixture('ws_b', 0, '0'),
      ]),
    ],
    workspaceSummaries: [
      workspaceSummaryFixture('ws_a', {}),
      workspaceSummaryFixture('ws_b', {}),
      workspaceSummaryFixture('ws_c', {}),
    ],
    stepCompareSummaries: [compareSummaryFixture('Route'), compareSummaryFixture('STA')],
    dashboardSummary: dashboardSummaryFixture(),
    qorTrendSummary,
    branchLinks: [],
    comparisonSummary: {
      bestWorkspaceId: 'ws_b',
      bestReason: 'Highest eligible QoR score: 74.2',
      riskLabels: [],
      parameterDiffs: [],
      metricDiffs: [],
    },
    ...overrides,
    designName: overrides.designName ?? 'demo',
  }
}
