import { describe, expect, it } from 'vitest'
import {
  FLOW_STEPS,
  buildProjectManagementProject,
  createSelectionState,
  createProjectManifestDraft,
  createWorkspaceBranchDraft,
  parseWorkspaceFlowStateMap,
  archiveWorkspaceInManifest,
  deleteWorkspaceFromManifest,
  nextWorkspaceId,
  registerWorkspaceInManifest,
  serializeProjectManifest,
} from './projectManagement'
import type { Project } from '@/types'

const recentProject: Project = {
  id: '/projects/gcd',
  name: 'gcd_backend',
  path: '/projects/gcd',
  lastOpened: new Date('2026-07-02T08:00:00Z'),
  pdk: 'ics55',
  topModule: 'gcd',
  frequencyTarget: 100,
  status: 'in_progress',
  totalSteps: 12,
  completedSteps: 8,
}

describe('project management model', () => {
  it('uses the fixed project flow step order from the design plan', () => {
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

  it('builds an empty project detail model until a real project manifest is available', () => {
    const model = buildProjectManagementProject(recentProject, null)

    expect(model.name).toBe('gcd_backend')
    expect(model.path).toBe('/projects/gcd')
    expect(model.pdk).toBe('ics55')
    expect(model.topModule).toBe('gcd')
    expect(model.workspaces).toEqual([])
    expect(model.metricsRows).toEqual([])
    expect(model.branchLinks).toEqual([])
    expect(model.bestWorkspaceId).toBe('')
  })

  it('does not select a fake workspace when project data is empty', () => {
    const model = buildProjectManagementProject(recentProject, null)
    const selection = createSelectionState(model)

    expect(selection.selectedWorkspaceId).toBe('')
    expect(selection.selectedStep).toBe('DRC')
  })

  it('uses a neutral empty project when no source project exists', () => {
    const model = buildProjectManagementProject(null)

    expect(model.name).toBe('No Project Selected')
    expect(model.path).toBe('')
    expect(model.workspaces).toEqual([])
    expect(model.metricsRows).toEqual([])
  })

  it('maps project.json workspaces into lineage tree rows, status hints, metrics, and branch links', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-02T08:00:00.000Z',
    })
    manifest.base_design = {
      pdk: 'ics55',
      top_module: 'gcd',
      clock: 'clk',
      rtl_list: ['/rtl/gcd.v'],
      parameters: {
        'Frequency max [MHz]': 100,
      },
    }
    manifest.workspaces.push(
      {
        workspace_id: 'ws_0001',
        name: 'baseline',
        workspace_path: '/projects/gcd/workspaces/ws_0001',
        source_workspace_id: null,
        branch_from: null,
        start_step: 'Synth',
        end_step: 'STA',
        status: 'success',
        created_at: '2026-07-02T08:00:00.000Z',
        updated_at: '2026-07-02T08:30:00.000Z',
        parameter_patch: {},
        metrics_summary: {
          wns: -0.12,
          tns: -5.2,
          drc_count: 3,
        },
        step_metrics: {},
      },
      {
        workspace_id: 'ws_0002',
        name: 'fanout_from_floor',
        workspace_path: '/projects/gcd/workspaces/ws_0002',
        source_workspace_id: 'ws_0001',
        branch_from: {
          source_workspace_id: 'ws_0001',
          source_step: 'Floor',
          source_output_type: 'def',
          source_output_path: '/projects/gcd/workspaces/ws_0001/Floor/output/design.def',
        },
        start_step: 'Fanout',
        end_step: 'DRC',
        status: 'failed',
        created_at: '2026-07-02T09:00:00.000Z',
        updated_at: '2026-07-02T09:30:00.000Z',
        parameter_patch: {
          'Max fanout': {
            from: 20,
            to: 12,
          },
        },
        metrics_summary: {
          wns: -0.08,
          tns: -3.1,
          drc_count: 9,
        },
        step_metrics: {},
      },
    )
    manifest.best_workspace = {
      workspace_id: 'ws_0002',
      reason: 'Timing improved before DRC cleanup',
    }

    const model = buildProjectManagementProject(recentProject, manifest)

    expect(model.id).toBe('proj_gcd')
    expect(model.name).toBe('gcd')
    expect(model.pdk).toBe('ics55')
    expect(model.topModule).toBe('gcd')
    expect(model.bestWorkspaceId).toBe('ws_0002')
    expect(model.comparisonSummary.bestWorkspaceId).toBe('ws_0002')
    expect(model.comparisonSummary.bestReason).toBe('Timing improved before DRC cleanup')
    expect(model.comparisonSummary.riskLabels).toContain('DRC violations present')
    expect(model.comparisonSummary.parameterDiffs).toContainEqual({
      workspaceId: 'ws_0002',
      name: 'Max fanout',
      from: '20',
      to: '12',
    })
    expect(model.comparisonSummary.metricDiffs).toContainEqual({
      metric: 'DRC',
      fromWorkspaceId: 'ws_0001',
      toWorkspaceId: 'ws_0002',
      delta: 6,
      state: 'bad',
    })
    expect(model.workspaces).toHaveLength(2)
    expect(model.workspaces.map(workspace => [workspace.id, workspace.depth])).toEqual([
      ['ws_0001', 0],
      ['ws_0002', 1],
    ])
    expect(model.workspaces[0].flowStatusHint).toEqual({
      state: 'success',
      label: 'Success',
    })
    expect(model.workspaces[1]).toMatchObject({
      id: 'ws_0002',
      name: 'fanout_from_floor',
      workspacePath: '/projects/gcd/workspaces/ws_0002',
      description: 'from ws_0001/Floor',
      flowStatusHint: {
        state: 'failed',
        step: 'DRC',
        label: 'DRC failed',
      },
    })
    expect(model.workspaces[1].steps.find(cell => cell.step === 'Floor')?.status).toBe('reused')
    expect(model.workspaces[1].steps.find(cell => cell.step === 'Fanout')?.status).toBe('success')
    expect(model.workspaces[1].steps.find(cell => cell.step === 'STA')?.status).toBe('skipped')
    expect(model.branchLinks).toEqual([
      {
        fromWorkspaceId: 'ws_0001',
        fromStep: 'Floor',
        toWorkspaceId: 'ws_0002',
        toStep: 'Fanout',
      },
    ])
    expect(model.metricsRows.find(row => row.id === 'drc')?.points).toContainEqual({
      workspaceId: 'ws_0002',
      label: '9',
      value: 9,
      state: 'bad',
    })
    expect(model.dashboardSummary).toMatchObject({
      workspaceCount: 2,
      configuredStepCount: 19,
      successStepCount: 18,
      failedStepCount: 1,
      flowSuccessRatio: 95,
      drcCleanCount: 0,
    })
  })

  it('builds project-level workspace and step summaries from feature and STA snapshots', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-02T08:00:00.000Z',
    })
    manifest.base_design = {
      pdk: 'ics55',
      top_module: 'gcd',
      parameters: {},
    }
    manifest.workspaces.push(
      {
        workspace_id: 'baseline',
        name: 'baseline',
        workspace_path: '/projects/gcd/baseline',
        source_workspace_id: null,
        branch_from: null,
        start_step: 'Synth',
        end_step: 'STA',
        status: 'success',
        created_at: '2026-07-02T08:00:00.000Z',
        updated_at: '2026-07-02T08:30:00.000Z',
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      },
      {
        workspace_id: 'ws_0007',
        name: 'ws_0007',
        workspace_path: '/projects/gcd/ws_0007',
        source_workspace_id: 'baseline',
        branch_from: {
          source_workspace_id: 'baseline',
          source_step: 'Floor',
        },
        start_step: 'Fanout',
        end_step: 'STA',
        status: 'success',
        created_at: '2026-07-02T09:00:00.000Z',
        updated_at: '2026-07-02T09:30:00.000Z',
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      },
    )

    const featureInputs = {
      baseline: {
        files: {
          synthesisStat: JSON.stringify({
            design: { area: 800.5, num_cells: 340, num_wires: 361 },
          }),
          floorplanDb: JSON.stringify({
            'Design Layout': { die_usage: 0.31, core_usage: 0.4, die_area: 2259 },
            'Design Statis': { num_instances: 610, num_nets: 361 },
            Instances: { total: { area: 920 } },
          }),
          placeMap: JSON.stringify({
            Wirelength: { HPWL: 3900000, GRWL: 4553000 },
            Congestion: { overflow: { total: { union: 7 } } },
          }),
          ctsStep: JSON.stringify({
            CTS: { buffer_num: 4, buffer_area: 9.2, total_clock_wirelength: 250100 },
          }),
          ctsMap: JSON.stringify({
            Wirelength: { HPWL: 4010000, GRWL: 4620000 },
            Congestion: { overflow: { total: { union: 5 } } },
          }),
          routeStep: JSON.stringify({
            route: {
              DR: [
                { iter: 1, total_violation_num: 12, total_wire_length: 5200, total_via_num: 1510, total_patch_num: 49 },
                { iter: 2, total_violation_num: 2, total_wire_length: 5198, total_via_num: 1506, total_patch_num: 45 },
              ],
            },
          }),
          drcStep: JSON.stringify({ drc: { number: 2 } }),
        },
        staReports: [
          {
            corner: 'MAX_125/Cworst',
            content: JSON.stringify({ slack: [{ delay_type: 'max', WNS: '8.100', TNS: '0.000' }] }),
          },
          {
            corner: 'MIN_m40/Cbest',
            content: JSON.stringify({ slack: [{ delay_type: 'min', WNS: '0.080', TNS: '0.000' }] }),
          },
        ],
      },
      ws_0007: {
        files: {
          synthesisStat: JSON.stringify({
            design: { area: 758.24, num_cells: 335, num_wires: 361 },
          }),
          floorplanDb: JSON.stringify({
            'Design Layout': { die_usage: 0.335, core_usage: 0.416, die_area: 2259.86 },
            'Design Statis': { num_instances: 613, num_nets: 361 },
            Instances: { total: { area: 919 } },
          }),
          placeMap: JSON.stringify({
            Wirelength: { HPWL: 3884970, GRWL: 4553000 },
            Congestion: { overflow: { total: { union: 4 } } },
          }),
          ctsStep: JSON.stringify({
            CTS: { buffer_num: 3, buffer_area: 8.4, total_clock_wirelength: 249558 },
          }),
          ctsMap: JSON.stringify({
            Wirelength: { HPWL: 3983429, GRWL: 4610000 },
            Congestion: { overflow: { total: { union: 4 } } },
          }),
          routeStep: JSON.stringify({
            route: {
              DR: [
                { iter: 1, total_violation_num: 10, total_wire_length: 5199.1, total_via_num: 1512, total_patch_num: 47 },
                { iter: 2, total_violation_num: 0, total_wire_length: 5196.3, total_via_num: 1502, total_patch_num: 44 },
              ],
            },
          }),
          drcStep: JSON.stringify({ drc: { number: 0 } }),
        },
        staReports: [
          {
            corner: 'MAX_125/Cworst',
            content: JSON.stringify({ slack: [{ delay_type: 'max', WNS: '8.500', TNS: '0.000' }] }),
          },
          {
            corner: 'MIN_m40/Cbest',
            content: JSON.stringify({ slack: [{ delay_type: 'min', WNS: '0.095', TNS: '0.000' }] }),
          },
        ],
      },
    }

    const model = buildProjectManagementProject(recentProject, manifest, {}, featureInputs)
    const workspaceSummary = model.workspaceSummaries.find(summary => summary.workspaceId === 'ws_0007')

    expect(workspaceSummary?.finalMetrics.drcCount?.value).toBe(0)
    expect(workspaceSummary?.finalMetrics.setupWns?.value).toBe(8.5)
    expect(workspaceSummary?.finalMetrics.holdWns?.value).toBe(0.095)
    expect(workspaceSummary?.finalMetrics.area?.value).toBe(758.24)
    expect(workspaceSummary?.steps.find(step => step.step === 'Route')?.metrics).toEqual([])
    expect(model.metricsRows.find(row => row.id === 'drc')?.points).toContainEqual({
      workspaceId: 'ws_0007',
      label: '0',
      value: 0,
      state: 'good',
    })

    const staCompare = model.stepCompareSummaries.find(summary => summary.step === 'STA')
    expect(staCompare?.metrics).toEqual([])

    const drcCompare = model.stepCompareSummaries.find(summary => summary.step === 'DRC')
    expect(drcCompare?.metrics).toEqual([])
    expect(drcCompare?.missingCount).toBe(2)
  })

  it('uses each step analysis metrics json as the Step Analysis metric source', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-02T08:00:00.000Z',
    })
    manifest.workspaces.push(
      {
        workspace_id: 'baseline',
        name: 'baseline',
        workspace_path: '/projects/gcd/baseline',
        source_workspace_id: null,
        branch_from: null,
        start_step: 'Synth',
        end_step: 'Harden',
        status: 'success',
        created_at: '2026-07-02T08:00:00.000Z',
        updated_at: '2026-07-02T08:30:00.000Z',
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      },
      {
        workspace_id: 'ws_0008',
        name: 'ws_0008',
        workspace_path: '/projects/gcd/ws_0008',
        source_workspace_id: 'baseline',
        branch_from: {
          source_workspace_id: 'baseline',
          source_step: 'Floor',
        },
        start_step: 'Fanout',
        end_step: 'Harden',
        status: 'success',
        created_at: '2026-07-02T09:00:00.000Z',
        updated_at: '2026-07-02T09:30:00.000Z',
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      },
    )

    const model = buildProjectManagementProject(recentProject, manifest, {}, {
      baseline: {
        stepMetricTexts: {
          Route: JSON.stringify({ Tool: 'ecc', wire_len: 5196.258, num_via: 1502 }),
          DRC: JSON.stringify({ Tool: 'ecc', drc_num: 0 }),
        },
      },
      ws_0008: {
        stepMetricTexts: {
          Route: JSON.stringify({ Tool: 'ecc', wire_len: 4800.5, num_via: 1330 }),
          DRC: JSON.stringify({ Tool: 'ecc', drc_num: 2 }),
        },
      },
    })

    const routeCompare = model.stepCompareSummaries.find(summary => summary.step === 'Route')
    expect(routeCompare?.metrics.map(metric => metric.label)).toEqual(['wire len', 'num via'])
    expect(routeCompare?.metrics.find(metric => metric.id === 'wire_len')?.points.map(point => [point.workspaceId, point.value, point.label])).toEqual([
      ['baseline', 5196.258, '5196.258'],
      ['ws_0008', 4800.5, '4800.5'],
    ])
    expect(routeCompare?.metrics.find(metric => metric.id === 'num_via')?.points.map(point => [point.workspaceId, point.value])).toEqual([
      ['baseline', 1502],
      ['ws_0008', 1330],
    ])

    const drcCompare = model.stepCompareSummaries.find(summary => summary.step === 'DRC')
    expect(drcCompare?.metrics.map(metric => metric.label)).toEqual(['drc num'])
    expect(drcCompare?.points.map(point => [point.workspaceId, point.value, point.state])).toEqual([
      ['baseline', 0, 'good'],
      ['ws_0008', 2, 'warn'],
    ])

    const legalCompare = model.stepCompareSummaries.find(summary => summary.step === 'Legal')
    expect(legalCompare?.metrics).toEqual([])
    expect(legalCompare?.missingCount).toBe(2)
  })

  it('uses workspace home flow.json states for tree status hints and step cells when available', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-02T08:00:00.000Z',
    })
    manifest.workspaces.push({
      workspace_id: 'rtl_2_harden',
      name: 'rtl_2_harden',
      workspace_path: '/projects/gcd/rtl_2_harden',
      source_workspace_id: null,
      branch_from: null,
      start_step: 'Synth',
      end_step: 'Harden',
      status: 'success',
      created_at: '2026-07-02T08:00:00.000Z',
      updated_at: '2026-07-02T08:00:00.000Z',
      parameter_patch: {},
      metrics_summary: {},
      step_metrics: {},
    })

    const flowStates = parseWorkspaceFlowStateMap(JSON.stringify({
      steps: [
        { name: 'Synthesis', state: 'Success' },
        { name: 'Floorplan', state: 'Unstart' },
        { name: 'fixFanout', state: 'Ongoing' },
        { name: 'place', state: 'Invalid' },
      ],
    }))
    const model = buildProjectManagementProject(recentProject, manifest, {
      rtl_2_harden: flowStates,
    })
    const workspace = model.workspaces[0]

    expect(workspace.steps.find(cell => cell.step === 'Synth')?.status).toBe('success')
    expect(workspace.steps.find(cell => cell.step === 'Floor')?.status).toBe('unstart')
    expect(workspace.steps.find(cell => cell.step === 'Floor')?.label).toBe('U')
    expect(workspace.steps.find(cell => cell.step === 'Fanout')?.status).toBe('running')
    expect(workspace.steps.find(cell => cell.step === 'Place')?.status).toBe('failed')
    expect(workspace.steps.find(cell => cell.step === 'CTS')?.status).toBe('success')
    expect(workspace.flowStatusHint).toEqual({
      state: 'unstart',
      step: 'Floor',
      label: 'Floor unstart',
    })
  })

  it('summarizes flow runtime, peak memory, and checklist states for dashboard flow metrics', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-02T08:00:00.000Z',
    })
    manifest.workspaces.push(
      {
        workspace_id: 'ws_0001',
        name: 'ws_0001',
        workspace_path: '/projects/gcd/ws_0001',
        source_workspace_id: null,
        branch_from: null,
        start_step: 'Synth',
        end_step: 'STA',
        status: 'success',
        created_at: '2026-07-02T08:00:00.000Z',
        updated_at: '2026-07-02T08:00:00.000Z',
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      },
      {
        workspace_id: 'ws_0002',
        name: 'ws_0002',
        workspace_path: '/projects/gcd/ws_0002',
        source_workspace_id: 'ws_0001',
        branch_from: {
          source_workspace_id: 'ws_0001',
          source_step: 'Floor',
        },
        start_step: 'Fanout',
        end_step: 'STA',
        status: 'running',
        created_at: '2026-07-02T09:00:00.000Z',
        updated_at: '2026-07-02T09:00:00.000Z',
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      },
    )

    const model = buildProjectManagementProject(recentProject, manifest, {}, {
      ws_0001: {
        flowText: JSON.stringify({
          steps: [
            { name: 'Synthesis', runtime: '0:0:7', 'peak memory (mb)': 10 },
            { name: 'Floorplan', runtime: '0:1:2', 'peak memory (mb)': 128 },
          ],
        }),
        parametersText: JSON.stringify({
          Die: { Area: 2250 },
          Core: { Utilitization: 0.63 },
        }),
        checklistText: JSON.stringify({
          checklist: [
            { state: 'Passed' },
            { state: 'Failed' },
            { state: 'Warning' },
          ],
        }),
      },
      ws_0002: {
        flowText: JSON.stringify({
          steps: [
            { name: 'fixFanout', runtime: '12.5s', 'peak memory (mb)': 512 },
            { name: 'place', runtime: 4, 'peak memory (mb)': 256 },
          ],
        }),
        parametersText: JSON.stringify({
          Die: { Area: 2300 },
          Core: { Utilization: 0.71 },
        }),
        staReports: [
          {
            corner: 'MAX_125/Cworst',
            content: JSON.stringify({
              summary: [
                { delay_type: 'max', freq: '870' },
                { delay_type: 'min', freq: 'NA' },
              ],
            }),
          },
          {
            corner: 'MIN_m40/Cbest',
            content: JSON.stringify({
              summary: [
                { delay_type: 'max', freq: '830' },
                { delay_type: 'max', freq: '820' },
              ],
            }),
          },
        ],
        checklistText: JSON.stringify({
          checklist: [
            { state: 'Passed' },
            { state: 'Passed' },
            { state: 'Warn' },
          ],
        }),
      },
    })

    expect(model.workspaceSummaries.map(summary => [summary.workspaceId, summary.flowMetrics.totalRuntimeSec, summary.flowMetrics.peakMemoryMb])).toEqual([
      ['ws_0001', 69, 128],
      ['ws_0002', 16.5, 512],
    ])
    expect(model.dashboardSummary.flowMetricSummary).toMatchObject({
      totalRuntimeSec: 85.5,
      peakMemoryMb: 512,
      checklistPassed: 3,
      checklistFailed: 1,
      checklistWarning: 2,
      checklistTotal: 6,
    })
    expect(model.dashboardSummary.flowMetricSummary.runtimePoints.map(point => [point.workspaceId, point.value])).toEqual([
      ['ws_0001', 69],
      ['ws_0002', 16.5],
    ])
    expect(model.dashboardSummary.flowMetricSummary.memoryPoints.map(point => [point.workspaceId, point.value])).toEqual([
      ['ws_0001', 128],
      ['ws_0002', 512],
    ])
    expect(model.metricsRows.find(row => row.id === 'die_area')?.points.map(point => [point.workspaceId, point.value])).toEqual([
      ['ws_0001', 2250],
      ['ws_0002', 2300],
    ])
    expect(model.metricsRows.find(row => row.id === 'core_util')?.points.map(point => [point.workspaceId, point.value])).toEqual([
      ['ws_0001', 0.63],
      ['ws_0002', 0.71],
    ])
    expect(model.metricsRows.find(row => row.id === 'frequency')?.points.map(point => [point.workspaceId, point.value])).toEqual([
      ['ws_0001', null],
      ['ws_0002', 820],
    ])
    expect(model.workspaceSummaries.find(summary => summary.workspaceId === 'ws_0002')?.finalMetrics.frequency?.value).toBe(820)
  })

  it('keeps child workspaces close to their source workspace in lineage order', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-02T08:00:00.000Z',
    })
    const baseWorkspace = {
      name: '',
      workspace_path: '',
      source_workspace_id: null,
      branch_from: null,
      start_step: 'Synth' as const,
      end_step: 'Harden' as const,
      status: 'success' as const,
      created_at: '2026-07-02T08:00:00.000Z',
      updated_at: '2026-07-02T08:00:00.000Z',
      parameter_patch: {},
      metrics_summary: {},
      step_metrics: {},
    }
    manifest.workspaces.push(
      {
        ...baseWorkspace,
        workspace_id: 'ws_0003',
        name: 'independent',
        workspace_path: '/projects/gcd/ws_0003',
        created_at: '2026-07-02T11:00:00.000Z',
      },
      {
        ...baseWorkspace,
        workspace_id: 'ws_0002',
        name: 'child',
        workspace_path: '/projects/gcd/ws_0002',
        source_workspace_id: 'ws_0001',
        branch_from: {
          source_workspace_id: 'ws_0001',
          source_step: 'Floor',
        },
        start_step: 'Fanout',
        created_at: '2026-07-02T10:00:00.000Z',
      },
      {
        ...baseWorkspace,
        workspace_id: 'ws_0001',
        name: 'root',
        workspace_path: '/projects/gcd/ws_0001',
        created_at: '2026-07-02T09:00:00.000Z',
      },
    )

    const model = buildProjectManagementProject(recentProject, manifest)

    expect(model.workspaces.map(workspace => [workspace.id, workspace.depth])).toEqual([
      ['ws_0001', 0],
      ['ws_0002', 1],
      ['ws_0003', 0],
    ])
  })

  it('creates project manifest drafts and next workspace branch paths under the project root', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-02T08:00:00.000Z',
    })
    manifest.workspaces.push({
      workspace_id: 'ws_0001',
      name: 'baseline',
      workspace_path: '/projects/gcd/workspaces/ws_0001',
      source_workspace_id: null,
      branch_from: null,
      start_step: 'Synth',
      end_step: 'Harden',
      status: 'not_started',
      created_at: '2026-07-02T08:00:00.000Z',
      updated_at: '2026-07-02T08:00:00.000Z',
      parameter_patch: {},
      metrics_summary: {},
      step_metrics: {},
    })
    const project = buildProjectManagementProject(recentProject, manifest)

    expect(nextWorkspaceId(project)).toBe('ws_0002')
    expect(createWorkspaceBranchDraft(project, 'ws_0001', 'Floor')).toEqual({
      sourceWorkspaceId: 'ws_0001',
      sourceWorkspacePath: '/projects/gcd/workspaces/ws_0001',
      step: 'Floor',
      targetWorkspaceId: 'ws_0002',
      targetWorkspacePath: '/projects/gcd/ws_0002',
      targetStartStep: 'Fanout',
      targetEndStep: 'Harden',
      sourceOutputType: 'def',
      sourceOutputPath: '/projects/gcd/workspaces/ws_0001/Floorplan_ecc/output/gcd_Floorplan.def.gz',
      originDef: '/projects/gcd/workspaces/ws_0001/Floorplan_ecc/output/gcd_Floorplan.def.gz',
      originVerilog: '/projects/gcd/workspaces/ws_0001/Floorplan_ecc/output/gcd_Floorplan.v.gz',
      originSdc: '/projects/gcd/workspaces/ws_0001/origin/gcd.sdc',
    })
    expect(serializeProjectManifest(manifest)).toContain('"workspaces"')
    expect(serializeProjectManifest(manifest)).not.toContain('"iterations"')
  })

  it('registers created workspaces back into project.json without adding an iteration layer', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-02T08:00:00.000Z',
    })
    manifest.workspaces.push({
      workspace_id: 'ws_0001',
      name: 'baseline',
      workspace_path: '/projects/gcd/workspaces/ws_0001',
      source_workspace_id: null,
      branch_from: null,
      start_step: 'Synth',
      end_step: 'Harden',
      status: 'success',
      created_at: '2026-07-02T08:00:00.000Z',
      updated_at: '2026-07-02T08:30:00.000Z',
      parameter_patch: {},
      metrics_summary: {},
      step_metrics: {},
    })

    const updated = registerWorkspaceInManifest(manifest, {
      projectRoot: '/projects/gcd',
      projectName: 'gcd',
      workspacePath: '/projects/gcd/workspaces/ws_0002',
      sourceWorkspaceId: 'ws_0001',
      sourceStep: 'Floor',
      sourceOutputPath: '/projects/gcd/workspaces/ws_0001/Floor/output/design.def',
      sourceOutputType: 'def',
      now: '2026-07-02T09:00:00.000Z',
      config: {
        pdk: 'ics55',
        pdk_root: '/pdks/ics55',
        rtl_list: ['/rtl/gcd.v'],
        origin_verilog: '/rtl/gcd.v',
        parameters: {
          design: 'gcd_floor_branch',
          top_module: 'gcd',
          clock: 'clk',
        },
      },
    })

    expect(updated.workspaces).toHaveLength(2)
    expect(updated.workspaces[1]).toMatchObject({
      workspace_id: 'ws_0002',
      name: 'gcd_floor_branch',
      workspace_path: '/projects/gcd/workspaces/ws_0002',
      source_workspace_id: 'ws_0001',
      start_step: 'Fanout',
      end_step: 'Harden',
      status: 'not_started',
    })
    expect(updated.workspaces[1].branch_from).toMatchObject({
      source_workspace_id: 'ws_0001',
      source_step: 'Floor',
      source_output_type: 'def',
      source_output_path: '/projects/gcd/workspaces/ws_0001/Floor/output/design.def',
    })
    expect(updated.workspaces[1].parameter_patch).toMatchObject({
      design: { from: undefined, to: 'gcd_floor_branch' },
      top_module: { from: undefined, to: 'gcd' },
      clock: { from: undefined, to: 'clk' },
    })
    expect(updated.base_design).toMatchObject({
      pdk: 'ics55',
      pdk_root: '/pdks/ics55',
      top_module: 'gcd',
      clock: 'clk',
      origin_verilog: '/rtl/gcd.v',
      rtl_list: ['/rtl/gcd.v'],
    })
    expect(serializeProjectManifest(updated)).not.toContain('"iterations"')
  })

  it('registers imported project-root workspaces by workspace folder name', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-02T08:00:00.000Z',
    })

    const updated = registerWorkspaceInManifest(manifest, {
      projectRoot: '/projects/gcd',
      projectName: 'gcd',
      workspacePath: '/projects/gcd/backend_a',
      now: '2026-07-02T09:00:00.000Z',
      config: {
        parameters: {
          design: 'backend_a',
        },
      },
    })

    expect(updated.workspaces).toHaveLength(1)
    expect(updated.workspaces[0]).toMatchObject({
      workspace_id: 'backend_a',
      name: 'backend_a',
      workspace_path: '/projects/gcd/backend_a',
      source_workspace_id: null,
      branch_from: null,
      start_step: 'Synth',
      end_step: 'Harden',
    })
  })

  it('archives and deletes workspaces in project.json without removing other workspaces', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-07-02T08:00:00.000Z',
    })
    manifest.workspaces.push(
      {
        workspace_id: 'ws_0001',
        name: 'baseline',
        workspace_path: '/projects/gcd/ws_0001',
        source_workspace_id: null,
        branch_from: null,
        start_step: 'Synth',
        end_step: 'Harden',
        status: 'success',
        created_at: '2026-07-02T08:00:00.000Z',
        updated_at: '2026-07-02T08:00:00.000Z',
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      },
      {
        workspace_id: 'ws_0002',
        name: 'branch',
        workspace_path: '/projects/gcd/ws_0002',
        source_workspace_id: 'ws_0001',
        branch_from: {
          source_workspace_id: 'ws_0001',
          source_step: 'Floor',
        },
        start_step: 'Fanout',
        end_step: 'Harden',
        status: 'failed',
        created_at: '2026-07-02T09:00:00.000Z',
        updated_at: '2026-07-02T09:00:00.000Z',
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      },
    )
    manifest.best_workspace = { workspace_id: 'ws_0002', reason: 'experimental' }

    const archived = archiveWorkspaceInManifest(manifest, 'ws_0002', '2026-07-02T10:00:00.000Z')
    expect(archived.workspaces.find(workspace => workspace.workspace_id === 'ws_0002')?.status).toBe('archived')
    expect(archived.best_workspace).toBeNull()

    const deleted = deleteWorkspaceFromManifest(archived, 'ws_0002', '2026-07-02T11:00:00.000Z')
    expect(deleted.workspaces.map(workspace => workspace.workspace_id)).toEqual(['ws_0001'])
    expect(deleted.workspaces[0].branch_from).toBeNull()
  })
})
