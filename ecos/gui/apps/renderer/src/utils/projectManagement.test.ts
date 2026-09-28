import { describe, expect, it } from 'vitest'
import {
  projectManifestForPresentation,
  createProjectManifestDraft,
  registerWorkspaceInManifest,
  type BackendProjectComparison,
  type ReadSection,
  type ResourceInfo,
} from '@ecos-studio/shared'
import {
  buildProjectManagementProject,
  createSelectionState,
  createWorkspaceBranchDraft,
  projectMpcOptionFromResource,
  resolveProjectQorBaselineWorkspace,
  resolveProjectSelectionUpdate,
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
  return manifestWithWorkspaces([workspaceId])
}

function manifestWithWorkspaces(workspaceIds: string[]) {
  const now = '2026-07-20T00:00:00.000Z'
  return projectManifestForPresentation(
    {
      schema_version: 1,
      project_id: 'proj_gcd',
      name: 'gcd',
      design_name: 'gcd',
      description: '',
      root_path: '/projects/gcd',
      created_at: now,
      updated_at: now,
      base_design: { pdk: 'ics55', top_module: 'gcd_top', parameters: {} },
      objectives: { primary: 'timing', directions: {} },
      workspaces: workspaceIds.map((workspaceId) => ({
        workspace_id: workspaceId,
        name: workspaceId,
        workspace_path: workspaceId,
        source_workspace_id: null,
        branch_from: null,
        start_step: 'Synth',
        end_step: 'Harden',
        status: 'not_started' as const,
        created_at: now,
        updated_at: now,
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      })),
      mpc: null,
      best_workspace: null,
      qor_baseline: workspaceIds[0]
        ? { workspace_id: workspaceIds[0], reason: 'Default project QoR baseline' }
        : null,
    },
    '/projects/gcd',
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
    expect(model.projectType).toBe('backend')
    expect(model.workspaces).toEqual([])
    expect(model.metricsRows).toEqual([])
    expect(createSelectionState(model).selectedWorkspaceId).toBe('')
    expect(createSelectionState(model).selectedStep).toBe('DRC')
  })

  it('uses the frontend profile for workspace steps and analysis', () => {
    const manifest = registerWorkspaceInManifest(
      createProjectManifestDraft({
        rootPath: '/projects/cpu',
        name: 'cpu',
        designName: 'cpu',
        projectType: 'frontend',
      }),
      {
        projectRoot: '/projects/cpu',
        workspacePath: '/projects/cpu/ws_0001',
      },
    )
    const flow = {
      prepare: 'success',
      review: 'success',
      elab: 'success',
      lint: 'success',
      sim: 'success',
    } as const
    const model = buildProjectManagementProject(
      { ...project, projectType: 'frontend' },
      manifest,
      { ws_0001: flow },
      null,
      {
        ws_0001: {
          frontendDetailTexts: {
            sim: JSON.stringify({
              summary: { total_cases: 2, passed_cases: 2, failed_cases: 0 },
              cases: [],
            }),
          },
        },
      },
    )

    expect(model.flowSteps).toEqual(['prepare', 'review', 'elab', 'lint', 'sim'])
    expect(model.workspaces[0]).toMatchObject({
      startStep: 'prepare',
      endStep: 'sim',
      status: 'success',
      flowStatusHint: { state: 'success', label: 'Success' },
    })
    expect(model.workspaces[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'prepare',
          status: 'success',
          canCreateWorkspace: false,
        }),
        expect.objectContaining({
          step: 'sim',
          status: 'success',
          canCreateWorkspace: false,
        }),
      ]),
    )
    expect(model.workspaceSummaries).toEqual([])
    expect(model.stepCompareSummaries).toEqual([])
    expect(model.frontendAnalysis).toMatchObject({ totalCases: 2, passedCases: 2 })
    expect(createSelectionState(model).selectedStep).toBe('sim')
  })

  it('keeps frontend descendants adjacent to their parent workspace', () => {
    const firstRoot = registerWorkspaceInManifest(
      createProjectManifestDraft({
        rootPath: '/projects/cpu',
        name: 'cpu',
        designName: 'cpu',
        projectType: 'frontend',
        now: '2026-08-20T00:00:00.000Z',
      }),
      {
        projectRoot: '/projects/cpu',
        workspacePath: '/projects/cpu/ws_0001',
        now: '2026-08-20T00:00:00.000Z',
      },
    )
    const secondRoot = registerWorkspaceInManifest(firstRoot, {
      projectRoot: '/projects/cpu',
      workspacePath: '/projects/cpu/ws_0002',
      now: '2026-08-20T00:01:00.000Z',
    })
    const manifest = registerWorkspaceInManifest(secondRoot, {
      projectRoot: '/projects/cpu',
      workspacePath: '/projects/cpu/ws_0003',
      sourceWorkspaceId: 'ws_0001',
      sourceStep: 'review',
      now: '2026-08-20T00:02:00.000Z',
    })

    const model = buildProjectManagementProject(
      { ...project, projectType: 'frontend' },
      manifest,
    )

    expect(model.workspaces.map((workspace) => [workspace.id, workspace.depth])).toEqual([
      ['ws_0001', 0],
      ['ws_0003', 1],
      ['ws_0002', 0],
    ])

    expect(
      resolveProjectSelectionUpdate('/projects/other', model, 'ws_0001', 'ws_0002'),
    ).toMatchObject({
      mode: 'reset',
      selection: { selectedWorkspaceId: 'ws_0002' },
    })
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
    const source = manifestWithWorkspace('ws_0014')
    const manifest = {
      ...source,
      workspaces: [
        ...source.workspaces,
        {
          ...source.workspaces[0]!,
          workspace_id: backupId,
          name: 'ws_0014 backup',
          workspace_path: `/projects/gcd/${backupId}`,
          status: 'archived' as const,
        },
      ],
    }

    const model = buildProjectManagementProject(project, manifest, {
      [backupId]: { Synth: 'success', Harden: 'success' },
    })
    const backup = model.workspaces.find((workspace) => workspace.id === backupId)

    expect(backup).toMatchObject({
      status: 'archived',
      flowStatusHint: { state: 'success', label: 'Success' },
    })
  })

  it('keeps a warning flow completed and eligible for branching', () => {
    const source = manifestWithWorkspace('ws_warning')
    const manifest = {
      ...source,
      workspaces: [{ ...source.workspaces[0]!, status: 'warning' as const }],
    }

    const model = buildProjectManagementProject(project, manifest, {
      ws_warning: { Synth: 'success', LEC: 'warning' },
    })

    expect(model.workspaces[0]).toMatchObject({
      status: 'warning',
      flowStatusHint: { state: 'warning', label: 'Completed with warnings' },
    })
    expect(model.workspaces[0]?.steps.find((step) => step.step === 'LEC')).toMatchObject({
      status: 'warning',
      canCreateWorkspace: true,
    })
  })

  it('floors an optimistic flow hint at a failed manifest status', () => {
    const source = manifestWithWorkspace('ws_dirty')
    const manifest = {
      ...source,
      workspaces: [{ ...source.workspaces[0]!, status: 'failed' as const }],
    }

    const model = buildProjectManagementProject(project, manifest, {
      ws_dirty: { Synth: 'success', Harden: 'success' },
    })

    expect(model.workspaces[0]).toMatchObject({
      status: 'failed',
      flowStatusHint: { state: 'failed', label: 'Failed' },
    })
    expect(model.workspaces[0]?.flowStatusHint.step).toBeUndefined()
    // Step cells keep the recorded flow facts; only the display reduction is floored.
    expect(
      model.workspaces[0]?.steps.find((step) => step.step === 'Synth'),
    ).toMatchObject({ status: 'success' })
    expect(model.dashboardSummary.runStateSlices).toEqual([
      { state: 'failed', label: 'Failed', count: 1, percent: 100 },
    ])
  })

  it('floors an all-success flow hint at a warning manifest status', () => {
    const source = manifestWithWorkspace('ws_dirty_warning')
    const manifest = {
      ...source,
      workspaces: [{ ...source.workspaces[0]!, status: 'warning' as const }],
    }

    const model = buildProjectManagementProject(project, manifest, {
      ws_dirty_warning: { Synth: 'success', Harden: 'success' },
    })

    expect(model.workspaces[0]).toMatchObject({
      status: 'warning',
      flowStatusHint: { state: 'warning', label: 'Completed with warnings' },
    })
    expect(model.workspaces[0]?.flowStatusHint.step).toBeUndefined()
  })

  it('drops the step attribution when the floor overrides an active hint', () => {
    const source = manifestWithWorkspace('ws_stale_running')
    const manifest = {
      ...source,
      workspaces: [{ ...source.workspaces[0]!, status: 'failed' as const }],
    }

    const model = buildProjectManagementProject(project, manifest, {
      ws_stale_running: { Synth: 'success', Place: 'running' },
    })

    expect(model.workspaces[0]).toMatchObject({
      status: 'failed',
      flowStatusHint: { state: 'failed', label: 'Failed' },
    })
    expect(model.workspaces[0]?.flowStatusHint.step).toBeUndefined()
  })

  it('does not floor flow-driven display for progress manifest statuses', () => {
    const runningSource = manifestWithWorkspace('ws_running')
    const runningModel = buildProjectManagementProject(
      project,
      {
        ...runningSource,
        workspaces: [{ ...runningSource.workspaces[0]!, status: 'running' as const }],
      },
      { ws_running: { Synth: 'success', Place: 'running' } },
    )
    expect(runningModel.workspaces[0]).toMatchObject({
      status: 'running',
      flowStatusHint: { state: 'running', step: 'Place', label: 'Place running' },
    })

    const successSource = manifestWithWorkspace('ws_success')
    const successModel = buildProjectManagementProject(
      project,
      {
        ...successSource,
        workspaces: [{ ...successSource.workspaces[0]!, status: 'success' as const }],
      },
      { ws_success: { Synth: 'success', Harden: 'success' } },
    )
    expect(successModel.workspaces[0]).toMatchObject({
      status: 'success',
      flowStatusHint: { state: 'success', label: 'Success' },
    })

    // flow.json is authoritative for execution state: a recorded success flow may
    // still display success while the manifest lags at not_started.
    const freshModel = buildProjectManagementProject(
      project,
      manifestWithWorkspace('ws_fresh'),
      { ws_fresh: { Synth: 'success', Harden: 'success' } },
    )
    expect(freshModel.workspaces[0]).toMatchObject({
      status: 'success',
      flowStatusHint: { state: 'success', label: 'Success' },
    })
  })

  it('keeps a recorded failure visible when the manifest status is less severe', () => {
    const source = manifestWithWorkspace('ws_failed_step')
    const manifest = {
      ...source,
      workspaces: [{ ...source.workspaces[0]!, status: 'warning' as const }],
    }

    const model = buildProjectManagementProject(project, manifest, {
      ws_failed_step: { Synth: 'failed' },
    })

    expect(model.workspaces[0]).toMatchObject({
      status: 'failed',
      flowStatusHint: { state: 'failed', step: 'Synth', label: 'Synth failed' },
    })
  })

  it('resolves and persists the project-local default QoR baseline rule', () => {
    const manifest = manifestWithWorkspaces(['ws_0001', 'ws_0004'])
    const legacyManifest = { ...manifest, qor_baseline: null }

    expect(resolveProjectQorBaselineWorkspace(legacyManifest, 'ws_0004')).toEqual({
      workspaceId: 'ws_0001',
      source: 'default',
      archivedLabel: null,
    })
    expect(resolveProjectQorBaselineWorkspace(legacyManifest, 'ws_0001')).toEqual({
      workspaceId: 'ws_0004',
      source: 'default',
      archivedLabel: null,
    })
    expect(
      resolveProjectQorBaselineWorkspace(manifestWithWorkspace(), 'ws_0004'),
    ).toEqual({
      workspaceId: 'ws_0004',
      source: 'selected',
      archivedLabel: null,
    })
  })

  it('resolves a repointed baseline to the archived backup with a source label', () => {
    const now = '2026-07-20T00:00:00.000Z'
    const base = manifestWithWorkspaces(['ws_0001', 'ws_0002'])
    const backupEntry = {
      workspace_id: '.ws_0001.replace-backup-1',
      name: '.ws_0001.replace-backup-1 backup',
      workspace_path: '.ws_0001.replace-backup-1',
      source_workspace_id: 'ws_0001',
      branch_from: null,
      start_step: 'Synth' as const,
      end_step: 'Harden' as const,
      status: 'archived' as const,
      created_at: now,
      updated_at: now,
      parameter_patch: {},
      metrics_summary: {},
      step_metrics: {},
    }
    const manifest = {
      ...base,
      workspaces: [...base.workspaces, backupEntry],
      qor_baseline: {
        workspace_id: '.ws_0001.replace-backup-1',
        reason: 'Default project QoR baseline',
      },
    }

    // A baseline pointer repointed at the archived replace backup resolves to
    // it and carries the lineage annotation for the UI.
    expect(resolveProjectQorBaselineWorkspace(manifest, 'ws_0001')).toEqual({
      workspaceId: '.ws_0001.replace-backup-1',
      source: 'selected',
      archivedLabel: 'Archived backup of ws_0001',
    })

    // Default resolution reaches archived entries too: the archived ws_0001
    // (without recorded lineage) is the default for ws_0002, labeled by its
    // own id.
    const withoutSelection = {
      ...manifest,
      workspaces: manifest.workspaces.map((workspace) =>
        workspace.workspace_id === 'ws_0001'
          ? { ...workspace, status: 'archived' as const, source_workspace_id: null }
          : workspace,
      ),
      qor_baseline: null,
    }
    expect(resolveProjectQorBaselineWorkspace(withoutSelection, 'ws_0002')).toEqual({
      workspaceId: 'ws_0001',
      source: 'default',
      archivedLabel: 'Archived backup of ws_0001',
    })

    // The current-workspace fallback also accepts an archived entry.
    const archivedCurrent = {
      ...withoutSelection,
      workspaces: withoutSelection.workspaces.filter(
        (workspace) => workspace.workspace_id === 'ws_0001',
      ),
    }
    expect(resolveProjectQorBaselineWorkspace(archivedCurrent, 'ws_0001')).toEqual({
      workspaceId: 'ws_0001',
      source: 'default',
      archivedLabel: 'Archived backup of ws_0001',
    })
  })

  it('annotates the trend baseline label when the baseline is an archived backup', () => {
    const now = '2026-07-20T00:00:00.000Z'
    const base = manifestWithWorkspaces(['ws_0001'])
    const manifest = {
      ...base,
      workspaces: [
        ...base.workspaces,
        {
          workspace_id: '.ws_0001.replace-backup-1',
          name: '.ws_0001.replace-backup-1 backup',
          workspace_path: '.ws_0001.replace-backup-1',
          source_workspace_id: 'ws_0001',
          branch_from: null,
          start_step: 'Synth' as const,
          end_step: 'Harden' as const,
          status: 'archived' as const,
          created_at: now,
          updated_at: now,
          parameter_patch: {},
          metrics_summary: {},
          step_metrics: {},
        },
      ],
      qor_baseline: {
        workspace_id: '.ws_0001.replace-backup-1',
        reason: 'Default project QoR baseline',
      },
    }
    const comparison: BackendProjectComparison = {
      identity: { designName: 'gcd', projectId: 'gcd', projectName: 'gcd' },
      refresh: { automatic: 'available' },
      trend: {
        data: trendSummaryFixture(
          [{ workspaceId: 'ws_0001' }, { workspaceId: '.ws_0001.replace-backup-1' }],
          '.ws_0001.replace-backup-1',
        ),
        issues: [],
        status: 'ready',
      },
      workspaceSnapshots: {
        data: { flowStates: {}, items: [] },
        issues: [],
        status: 'ready',
      },
      stepComparisons: { data: { steps: [] }, issues: [], status: 'ready' },
      recommendation: { issues: [], status: 'unavailable' },
      risks: { data: { items: [] }, issues: [], status: 'ready' },
      timingTriage: { data: { items: [] }, issues: [], status: 'ready' },
    }

    const model = buildProjectManagementProject(project, manifest, {}, comparison)

    // Every trend label surface reads the annotated source instead of the
    // generated backup entry name.
    expect(model.qorTrendSummary.baselineLabel).toBe('Archived backup of ws_0001')
    expect(model.qorTrendSummary.baselineWorkspaceId).toBe('.ws_0001.replace-backup-1')

    // An active baseline keeps its trend-computed label.
    const activeComparison: BackendProjectComparison = {
      ...comparison,
      trend: {
        data: trendSummaryFixture([{ workspaceId: 'ws_0001' }], 'ws_0001'),
        issues: [],
        status: 'ready',
      },
    }
    const activeModel = buildProjectManagementProject(
      project,
      manifestWithWorkspaces(['ws_0001']),
      {},
      activeComparison,
    )
    expect(activeModel.qorTrendSummary.baselineLabel).toBe('ws_0001')
  })
})

describe('createWorkspaceBranchDraft', () => {
  it('uses ECC-resolved artifact paths for a layout step branch', () => {
    const model = buildProjectManagementProject(project, manifestWithWorkspace('ws_0002'))
    const defPath =
      '/projects/gcd/ws_0002/postFloorplan_ecc/output/gcd_postFloorplan.def.gz'
    const verilogPath =
      '/projects/gcd/ws_0002/postFloorplan_ecc/output/gcd_postFloorplan.v.gz'

    expect(
      createWorkspaceBranchDraft(model, 'ws_0002', {
        step: 'postFloorplan',
        nextStep: 'place',
        verilogPath,
        defPath,
        sdcPath: '/projects/gcd/ws_0002/origin/gcd.sdc',
      }),
    ).toEqual({
      sourceWorkspaceId: 'ws_0002',
      sourceWorkspacePath: '/projects/gcd/ws_0002',
      step: 'postFloorplan',
      targetWorkspaceId: 'ws_0003',
      targetWorkspacePath: '/projects/gcd/ws_0003',
      targetStartStep: 'place',
      targetEndStep: 'Harden',
      sourceOutputType: 'def',
      sourceOutputPath: defPath,
      originDef: defPath,
      originVerilog: verilogPath,
      originSdc: '/projects/gcd/ws_0002/origin/gcd.sdc',
    })
  })

  it('branches from a netlist-only step output as verilog', () => {
    const model = buildProjectManagementProject(project, manifestWithWorkspace('ws_0002'))
    const verilogPath = '/projects/gcd/ws_0002/Synthesis_yosys/output/gcd_Synthesis.v.gz'

    expect(
      createWorkspaceBranchDraft(model, 'ws_0002', {
        step: 'Synthesis',
        nextStep: 'preFloorplan',
        verilogPath,
        defPath: null,
        sdcPath: null,
      }),
    ).toEqual({
      sourceWorkspaceId: 'ws_0002',
      sourceWorkspacePath: '/projects/gcd/ws_0002',
      step: 'Synthesis',
      targetWorkspaceId: 'ws_0003',
      targetWorkspacePath: '/projects/gcd/ws_0003',
      targetStartStep: 'preFloorplan',
      targetEndStep: 'Harden',
      sourceOutputType: 'verilog',
      sourceOutputPath: verilogPath,
      originVerilog: verilogPath,
    })
  })
})
