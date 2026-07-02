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

  it('maps project.json workspaces into matrix rows, metrics, and branch links', () => {
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
    expect(model.workspaces[1]).toMatchObject({
      id: 'ws_0002',
      name: 'fanout_from_floor',
      workspacePath: '/projects/gcd/workspaces/ws_0002',
      description: 'from ws_0001/Floor',
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
  })

  it('uses workspace home flow.json states for matrix cells when available', () => {
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
      step: 'Floor',
      targetWorkspaceId: 'ws_0002',
      targetWorkspacePath: '/projects/gcd/ws_0002',
      targetStartStep: 'Fanout',
      targetEndStep: 'Harden',
      sourceOutputType: 'def',
      sourceOutputPath: '/projects/gcd/workspaces/ws_0001/Floor/output/design.def',
      originDef: '/projects/gcd/workspaces/ws_0001/Floor/output/design.def',
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
