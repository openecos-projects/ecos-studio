import { describe, expect, it } from 'vitest'
import {
  createProjectManifestDraft,
  recordReplacementBackupInManifest,
  registerWorkspaceInManifest,
  type BackendProjectComparison,
  type ReadSection,
  type ResourceInfo,
} from '@ecos-studio/shared'
import {
  buildProjectManagementProject,
  createSelectionState,
  projectMpcOptionFromResource,
  resolveProjectQorBaselineWorkspace,
} from './projectManagement'
import type { Project } from '@/types'
import {
  metricRecordFixture,
  signoffReadinessFixture,
  stepSnapshotFixture,
  trendSummaryFixture,
} from '@/components/projectStepAnalysis.fixture'

const project: Project = {
  id: '/projects/gcd',
  name: 'gcd',
  path: '/projects/gcd',
  lastOpened: new Date('2026-07-20T00:00:00Z'),
  status: 'success',
  totalSteps: 12,
  completedSteps: 12,
}

function managedMpc(overrides: Partial<ResourceInfo> = {}): ResourceInfo {
  return {
    id: 'mpc:mpc-frame',
    type: 'mpc',
    name: 'mpc-frame',
    display_name: 'MPC Frame',
    description: 'Multi-project chip frame template.',
    category: 'mpc',
    status: 'installed',
    installed_version: '0.1.0',
    available_versions: ['0.1.0'],
    active_version: null,
    active: false,
    path: '/resources/mpcs/mpc-frame/0.1.0',
    managed_root: '/resources/mpcs',
    platform: null,
    size: null,
    source: 'registry',
    homepage: 'https://github.com/openecos-projects/mpc-frame',
    actions: ['uninstall'],
    health: { managed: true, status: 'ok' },
    error: null,
    ...overrides,
  }
}

function manifestWithWorkspace(workspaceId = 'ws_0004') {
  return registerWorkspaceInManifest(
    createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      designName: 'gcd',
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

function comparisonWithUnknownStep(): BackendProjectComparison {
  const ready = <T>(data: T): Extract<ReadSection<T>, { status: 'ready' }> => ({
    data,
    issues: [],
    status: 'ready',
  })
  const trend = trendSummaryFixture([{ workspaceId: 'ws_0004' }])
  return {
    identity: { designName: 'gcd', projectId: 'gcd', projectName: 'gcd' },
    refresh: { automatic: 'available' },
    trend: ready(trend),
    workspaceSnapshots: ready({ flowStates: {}, items: [] }),
    stepComparisons: ready({
      steps: [
        {
          stepId: 'CustomSignoff',
          order: 13,
          name: 'CustomSignoff',
          workspaces: [{ workspaceId: 'ws_0004', status: 'success', metrics: [] }],
        },
      ],
    }),
    recommendation: { issues: [], status: 'unavailable' },
    risks: ready({ items: trend.risks }),
    timingTriage: ready({ items: trend.timingClosure.triage }),
  }
}

describe('project management V3 model', () => {
  it('selects only healthy managed MPC resources and derives their spec path', () => {
    expect(projectMpcOptionFromResource(managedMpc())).toEqual({
      resource_id: 'mpc:mpc-frame',
      display_name: 'MPC Frame',
      installed_version: '0.1.0',
      path: '/resources/mpcs/mpc-frame/0.1.0',
      spec_path: '/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
    })
    expect(
      projectMpcOptionFromResource(
        managedMpc({ health: { managed: false, status: 'ok' } }),
      ),
    ).toBeNull()
    expect(
      projectMpcOptionFromResource(
        managedMpc({ status: 'available', installed_version: null, path: null }),
      ),
    ).toBeNull()
  })

  it('builds an empty model without manufacturing metric rows', () => {
    const model = buildProjectManagementProject(project, null)
    expect(model.workspaces).toEqual([])
    expect(model.metricsRows).toEqual([])
    expect(createSelectionState(model).selectedWorkspaceId).toBe('')
  })

  it('keeps backend comparison steps that are not part of the built-in flow', () => {
    const model = buildProjectManagementProject(
      project,
      manifestWithWorkspace(),
      {},
      comparisonWithUnknownStep(),
    )

    expect(model.stepCompareSummaries).toEqual([{ step: 'CustomSignoff' }])
  })

  it('renders Electron-annotated comparison metrics without rebuilding them', () => {
    const comparison = comparisonWithUnknownStep()
    const snapshotMetric = metricRecordFixture({
      metricName: 'route_wirelength',
      value: 120,
    })
    const comparisonMetric = metricRecordFixture({
      metricName: 'route_wirelength',
      value: 100,
      baselineComparison: {
        baselineValue: 120,
        absoluteDelta: -20,
        relativeDeltaPct: -16.666667,
        verdict: 'improvement',
      },
      leads: true,
    })
    comparison.workspaceSnapshots = {
      data: {
        flowStates: {},
        items: [
          {
            workspaceId: 'ws_0004',
            steps: { Route: stepSnapshotFixture({ metrics: [snapshotMetric] }) },
            signoffReadiness: signoffReadinessFixture(),
            timingConstraints: {
              status: 'consistent',
              fingerprint: null,
              sourceFile: null,
              step: null,
            },
          },
        ],
      },
      issues: [],
      status: 'ready',
    }
    comparison.stepComparisons = {
      data: {
        steps: [
          {
            stepId: 'Route',
            order: 7,
            name: 'Route',
            workspaces: [
              { workspaceId: 'ws_0004', status: 'success', metrics: [comparisonMetric] },
            ],
          },
        ],
      },
      issues: [],
      status: 'ready',
    }

    const model = buildProjectManagementProject(
      project,
      manifestWithWorkspace(),
      {},
      comparison,
    )

    expect(model.workspaceSummaries[0]?.analysis.steps.Route?.metrics).toEqual([
      comparisonMetric,
    ])
  })

  it('does not manufacture step comparisons when the Electron section is unavailable', () => {
    const comparison = comparisonWithUnknownStep()
    comparison.stepComparisons = {
      issues: [{ code: 'STEP_COMPARISON_UNAVAILABLE' }],
      status: 'unavailable',
    }

    const model = buildProjectManagementProject(
      project,
      manifestWithWorkspace(),
      {},
      comparison,
    )

    expect(model.stepCompareSummaries).toEqual([])
  })

  it('keeps committed flow state for an archived replacement backup', () => {
    const backupId = '.ws_0014.replace-backup-1'
    const manifest = recordReplacementBackupInManifest(manifestWithWorkspace('ws_0014'), {
      backupPath: `/projects/gcd/${backupId}`,
      targetPath: '/projects/gcd/ws_0014',
    })

    const model = buildProjectManagementProject(project, manifest, {
      [backupId]: { Synth: 'success', Harden: 'success' },
    })
    const backup = model.workspaces.find((workspace) => workspace.id === backupId)

    expect(backup).toMatchObject({
      status: 'archived',
      flowStatusHint: { state: 'success', label: 'Success' },
    })
  })

  it('resolves and persists the project-local default QoR baseline rule', () => {
    const first = manifestWithWorkspace('ws_0001')
    const manifest = registerWorkspaceInManifest(first, {
      projectRoot: '/projects/gcd',
      workspacePath: '/projects/gcd/ws_0004',
      now: '2026-08-04T00:00:00.000Z',
    })
    const legacyManifest = { ...manifest, qor_baseline: null }

    expect(resolveProjectQorBaselineWorkspace(legacyManifest, 'ws_0004')).toEqual({
      workspaceId: 'ws_0001',
      source: 'default',
    })
    expect(resolveProjectQorBaselineWorkspace(legacyManifest, 'ws_0001')).toEqual({
      workspaceId: 'ws_0004',
      source: 'default',
    })
    expect(
      resolveProjectQorBaselineWorkspace(manifestWithWorkspace(), 'ws_0004'),
    ).toEqual({
      workspaceId: 'ws_0004',
      source: 'selected',
    })
  })
})
