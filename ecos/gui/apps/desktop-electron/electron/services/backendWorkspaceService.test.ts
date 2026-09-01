import type { EccEngineeringSnapshot, WorkspaceResourceIndex } from '@ecos-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import { BackendWorkspaceService } from './backendWorkspaceService'
import { runWithWindowScope } from './windowScopeContext'

function resourceIndex(): WorkspaceResourceIndex {
  const file = (kind: 'checklist' | 'flow' | 'home' | 'parameters') => ({
    exists: true,
    kind,
    path: `/project/ws-a/home/${kind}.json`,
  })
  return {
    design: 'gcd',
    flow: { steps: [] },
    home: {
      checklistJson: file('checklist'),
      flowJson: file('flow'),
      homeJson: file('home'),
      parametersJson: file('parameters'),
    },
    homeData: {},
    messages: [],
    parameters: {
      Clock: 'clk',
      Design: 'gcd',
      Die: { Area: 14400 },
      'Frequency max [MHz]': 200,
      'Max fanout': 24,
      PDK: 'ics55',
      'Top module': 'gcd_top',
    },
    pdk: 'ics55',
    root: '/project/ws-a',
    status: 'available',
    topModule: 'gcd_top',
  }
}

function engineeringSnapshot(index = resourceIndex()): EccEngineeringSnapshot {
  return {
    artifacts: [],
    checklist: { checklist: [] },
    flow: {
      steps: index.flow.steps.map((step) => ({
        info: step.info,
        name: step.name,
        'peak memory (mb)':
          step.peakMemoryMb ?? Number(step.info['peak memory (mb)'] ?? 0),
        runtime: step.runtime,
        state: step.state,
        tool: step.tool,
      })),
    },
    metrics: [],
    parameters: index.parameters ?? {},
    qorAssessment: { score: { gate: 'pass', threshold: 60, value: 73.5 } },
    schemaVersion: 1,
    signoffAssessment: { groups: [], risks: [], status: 'ready' },
    workspaceId: 'ecc-workspace-a',
    workspaceRevision: 1,
  }
}

function snapshotProvider(index = resourceIndex()) {
  return { getByDirectory: vi.fn().mockResolvedValue(engineeringSnapshot(index)) }
}

describe('BackendWorkspaceService', () => {
  it('returns window-scoped identity and configuration from one resource index', async () => {
    const getIndex = vi.fn().mockResolvedValue(resourceIndex())
    const readManifest = vi.fn().mockResolvedValue(
      JSON.stringify({
        base_design: {},
        best_workspace: null,
        created_at: '2026-08-30T00:00:00.000Z',
        description: '',
        design_name: 'gcd',
        mpc: null,
        name: 'demo-project',
        objectives: { directions: {}, primary: 'timing' },
        project_id: 'project-demo',
        qor_baseline: { reason: 'selected', workspace_id: 'ws-base' },
        root_path: '/project',
        schema_version: 1,
        updated_at: '2026-08-30T00:00:00.000Z',
        workspaces: [
          {
            branch_from: null,
            created_at: '2026-08-30T00:00:00.000Z',
            end_step: 'Harden',
            metrics_summary: {},
            name: 'Workspace A',
            parameter_patch: {},
            source_workspace_id: null,
            start_step: 'Synth',
            status: 'not_started',
            step_metrics: {},
            updated_at: '2026-08-30T00:00:00.000Z',
            workspace_id: 'ws-a',
            workspace_path: '/project/ws-a',
          },
        ],
      }),
    )
    const projectManagementReadService = {
      readManifest,
      async readWorkspaceTexts() {
        expect(this).toBe(projectManagementReadService)
        return { texts: {}, unavailablePaths: [] }
      },
    }
    const service = new BackendWorkspaceService({
      engineeringSnapshotProvider: snapshotProvider(),
      projectManagementReadService,
      workspaceResourceService: { getIndex },
    })

    const result = await runWithWindowScope(41, () => service.getOverview())

    expect(result).toMatchObject({
      generation: 0,
      overview: {
        configuration: {
          data: {
            clock: 'clk',
            design: 'gcd',
            dieArea: 14400,
            frequencyMaxMhz: 200,
            maxFanout: 24,
            pdk: 'ics55',
            topModule: 'gcd_top',
          },
          issues: [],
          status: 'ready',
        },
        identity: {
          baselineWorkspaceId: 'ws-base',
          projectId: 'project-demo',
          projectName: 'demo-project',
          workspaceId: 'ws-a',
          workspaceName: 'Workspace A',
        },
      },
    })
    expect(result.workspaceContextId).toEqual(expect.any(String))
    expect(result.overview.qor.status).toBe('ready')
    expect(getIndex).toHaveBeenCalledTimes(1)
    expect(readManifest).toHaveBeenCalledWith('/project')
  })

  it('returns ordered committed Flow facts without Renderer parsing', async () => {
    const index = resourceIndex()
    index.flow.steps = [
      {
        directory: '/project/ws-a/place_ecc',
        info: { 'peak memory (mb)': 812.5 },
        name: 'Place',
        resources: {
          analysis: {},
          checklist: {},
          config: {},
          data: {},
          feature: {},
          log: {},
          output: {},
          report: {},
          script: {},
          subflow: {},
        },
        runtime: '00:01:02.5',
        state: 'completed',
        tool: 'ecc',
      },
    ]
    const service = new BackendWorkspaceService({
      engineeringSnapshotProvider: snapshotProvider(index),
      workspaceResourceService: { getIndex: vi.fn().mockResolvedValue(index) },
    })

    const result = await runWithWindowScope(42, () => service.getOverview())

    expect(result.overview.flow).toEqual({
      data: {
        steps: [
          {
            name: 'Place',
            order: 0,
            peakMemoryMb: 812.5,
            runtimeSeconds: 62.5,
            state: 'succeeded',
            stepId: 'Place',
            toolId: 'ecc',
          },
        ],
      },
      issues: [],
      status: 'ready',
    })
  })

  it('keeps ECC Unstart steps queued instead of marking them invalid', async () => {
    const index = resourceIndex()
    index.flow.steps = [
      {
        directory: '/project/ws-a/Synthesis_yosys',
        info: {},
        name: 'Synthesis',
        resources: {
          analysis: {},
          checklist: {},
          config: {},
          data: {},
          feature: {},
          log: {},
          output: {},
          report: {},
          script: {},
          subflow: {},
        },
        runtime: '',
        state: 'Unstart',
        tool: 'yosys',
      },
    ]
    const service = new BackendWorkspaceService({
      engineeringSnapshotProvider: snapshotProvider(index),
      workspaceResourceService: { getIndex: vi.fn().mockResolvedValue(index) },
    })

    const result = await runWithWindowScope(42, () => service.getOverview())

    expect(result.overview.flow).toMatchObject({
      data: { steps: [{ stepId: 'Synthesis', state: 'not-started' }] },
    })
  })

  it('reports a damaged Flow section instead of a ready empty flow', async () => {
    const index = resourceIndex()
    index.flow.steps = []
    const snapshot = engineeringSnapshot(index)
    snapshot.flow = {}
    const service = new BackendWorkspaceService({
      engineeringSnapshotProvider: {
        getByDirectory: vi.fn().mockResolvedValue(snapshot),
      },
      workspaceResourceService: { getIndex: vi.fn().mockResolvedValue(index) },
    })

    const result = await runWithWindowScope(42, () => service.getOverview())

    expect(result.overview.flow).toMatchObject({
      status: 'error',
      issues: [{ code: 'WORKSPACE_FLOW_INVALID' }],
    })
  })

  it('reconciles only stale Flow checklist failures against committed success', async () => {
    const index = resourceIndex()
    index.flow.steps = [
      {
        directory: '/project/ws-a/place_ecc',
        info: {},
        name: 'Place',
        resources: {
          analysis: {},
          checklist: {},
          config: {},
          data: {},
          feature: {},
          log: {},
          output: {},
          report: {},
          script: {},
          subflow: {},
        },
        runtime: '',
        state: 'Success',
        tool: 'ecc',
      },
    ]
    const finding = (id: string, category: string) => ({
      blocked: true,
      category,
      evidence: [],
      id,
      owner: 'checklist',
      policy: 'block',
      source: {},
      state: 'failed',
      step: 'Place',
      summary: 'stale result',
      title: id,
    })
    const snapshot = engineeringSnapshot(index)
    snapshot.checklist = {
      checklist: [finding('flow-ready', 'flow'), finding('layout', 'artifact')],
    }
    const service = new BackendWorkspaceService({
      engineeringSnapshotProvider: {
        getByDirectory: vi.fn().mockResolvedValue(snapshot),
      },
      workspaceResourceService: { getIndex: vi.fn().mockResolvedValue(index) },
    })

    const result = await runWithWindowScope(43, () => service.getOverview())

    expect(result.overview.checklist).toMatchObject({
      data: {
        findings: [
          {
            blocked: false,
            category: 'flow',
            evidence: [
              {
                committedFlowState: 'Success',
                kind: 'flow-checklist-reconciliation',
                previousState: 'failed',
              },
            ],
            id: 'flow-ready',
            state: 'pass',
          },
          { blocked: true, category: 'artifact', id: 'layout', state: 'failed' },
        ],
      },
      issues: [],
      status: 'ready',
    })
  })

  it('coalesces one Query per generation and refreshes with a new generation', async () => {
    let resolveIndex!: (value: WorkspaceResourceIndex) => void
    const getIndex = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<WorkspaceResourceIndex>((resolve) => {
          resolveIndex = resolve
        }),
      )
      .mockResolvedValue(resourceIndex())
    const service = new BackendWorkspaceService({
      engineeringSnapshotProvider: snapshotProvider(),
      workspaceResourceService: { getIndex },
    })

    const first = runWithWindowScope(44, () => service.getOverview())
    const second = runWithWindowScope(44, () => service.getOverview())
    expect(getIndex).toHaveBeenCalledTimes(1)

    resolveIndex(resourceIndex())
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(secondResult).toEqual(firstResult)
    await runWithWindowScope(44, () => service.getOverview())
    expect(getIndex).toHaveBeenCalledTimes(1)

    const refreshed = await runWithWindowScope(44, () => service.refreshOverview())
    expect(refreshed.generation).toBe(1)
    expect(getIndex).toHaveBeenCalledTimes(2)
  })

  it('invalidates before notifying subscribers with the next generation', async () => {
    const service = new BackendWorkspaceService({
      engineeringSnapshotProvider: snapshotProvider(),
      workspaceResourceService: {
        getIndex: vi.fn().mockResolvedValue(resourceIndex()),
      },
    })
    const initial = await runWithWindowScope(45, () => service.getOverview())
    const listener = vi.fn()
    service.onInvalidated(listener)

    service.invalidateWindow(45)

    expect(listener).toHaveBeenCalledWith({
      generation: 1,
      windowId: 45,
      workspaceContextId: initial.workspaceContextId,
    })
    const refreshed = await runWithWindowScope(45, () => service.getOverview())
    expect(refreshed.generation).toBe(1)
  })
})
