import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  projectManifestForPresentation,
  type EccEngineeringMetric,
  type EccProjectManifest,
  type EccPersistedEngineeringSnapshot,
} from '@ecos-studio/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendWorkspaceService } from './backendWorkspaceService'
import { ProjectManagementReadService } from './projectManagementReadService'
import { runWithWindowScope } from './windowScopeContext'

const temporaryDirectories: string[] = []

function metric(id: string, value: number): EccEngineeringMetric {
  return {
    id,
    display_name: id === 'core_area' ? 'Core Area' : 'Instance Count',
    value,
    unit: id === 'core_area' ? 'um^2' : 'count',
    category: 'area_cost',
    direction: 'trend_only',
    scope: 'workspace',
    corner: null,
    analysis_group: 'physical_scale',
    rating: { gate: false, score: false, trend: true },
    project_role: 'trend',
    step_role: 'primary',
    confidence: 'high',
    source: { kind: 'feature', path: 'feature/Place.step.json', selector: '/count' },
  }
}

function snapshot(workspaceId: string, revision: number, value: number) {
  const metrics = [metric('instance_count', value), metric('core_area', 6400)]
  return {
    analysis: {
      steps: [
        {
          stepId: 'Place',
          toolId: 'ecc',
          order: 1,
          flowState: 'Success',
          metrics: {
            artifactId: 'place-metrics',
            status: 'available',
            data: {
              schema_version: 3,
              metrics,
              details: [
                {
                  id: 'database_facts',
                  summary: {
                    layout: { core_area: 6400 },
                    statistics: { instances: value },
                    instance_classes: [],
                    instance_total: { count: value, area: null, pin_count: null },
                    pin_distribution: [],
                    cut_layers: [],
                    routing_layers: [],
                    wire_length: null,
                    via_count: null,
                  },
                },
              ],
            },
          },
          summary: {
            artifactId: 'place-summary',
            status: 'missing',
            reasonCode: 'ANALYSIS_FILE_MISSING',
            data: null,
          },
          hotspots: {
            artifactId: 'place-hotspots',
            status: 'missing',
            reasonCode: 'ANALYSIS_FILE_MISSING',
            data: null,
          },
          timingIssues: null,
          subflow: {
            status: 'available',
            steps: [{ name: 'placement', state: 'Success' }],
          },
        },
      ],
    },
    artifacts: [],
    checklist: { checklist: [] },
    flow: {
      steps: [
        { name: 'Synthesis', tool: 'yosys', state: 'Success', runtime: '0:0:1' },
        { name: 'Place', tool: 'ecc', state: 'Success' },
      ],
    },
    metrics,
    parameters: {
      PDK: 'ics55',
      Design: 'gcd',
      'Top module': 'gcd',
      'Max fanout': 32,
    },
    qorAssessment: {
      status: 'ready',
      metrics,
      score: { value: 70, threshold: 60, gate: 'pass' },
      steps: [
        {
          stepId: 'Place',
          name: 'Place',
          order: 1,
          status: 'pass',
          summaryMetricCount: 2,
        },
      ],
    },
    schemaVersion: 2,
    signoffAssessment: { status: 'ready', groups: [], risks: [] },
    workspaceId,
    workspaceRevision: revision,
  } satisfies EccPersistedEngineeringSnapshot
}

describe('BackendWorkspaceService persisted integration', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
    )
  })

  it('loads current and baseline committed facts through the bounded reader', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'ecos-backend-workspace-'))
    temporaryDirectories.push(projectRoot)
    const currentRoot = join(projectRoot, 'ws_current')
    const baselineRoot = join(projectRoot, 'ws_baseline')
    await Promise.all(
      [currentRoot, baselineRoot].map((root) =>
        mkdir(join(root, 'home'), { recursive: true }),
      ),
    )
    const now = '2026-09-03T00:00:00.000Z'
    const manifest: EccProjectManifest = {
      schema_version: 1,
      project_id: 'proj_gcd',
      name: 'gcd',
      design_name: 'gcd',
      description: '',
      created_at: now,
      updated_at: now,
      objectives: {},
      workspaces: [
        {
          workspace_id: 'ws_current',
          name: 'ws_current',
          workspace_path: 'ws_current',
          source_workspace_id: null,
          lifecycle: 'active',
          created_at: now,
          updated_at: now,
        },
        {
          workspace_id: 'ws_baseline',
          name: 'ws_baseline',
          workspace_path: 'ws_baseline',
          source_workspace_id: null,
          lifecycle: 'active',
          created_at: now,
          updated_at: now,
        },
      ],
      mpc: null,
      best_workspace: null,
      qor_baseline: { workspace_id: 'ws_baseline', reason: 'selected' },
    }
    await Promise.all([
      writeFile(join(projectRoot, 'project.json'), JSON.stringify(manifest)),
      writeFile(
        join(currentRoot, 'home', 'engineering-snapshot.json'),
        JSON.stringify(snapshot('engineering-current', 7, 450)),
      ),
      writeFile(
        join(baselineRoot, 'home', 'engineering-snapshot.json'),
        JSON.stringify(snapshot('engineering-baseline', 3, 400)),
      ),
    ])
    const service = new BackendWorkspaceService({
      projectManagementReadService: new ProjectManagementReadService({
        discover: async () => null,
        load: async (root) => projectManifestForPresentation(manifest, root),
      }),
      workspaceRootProvider: { getProjectRoot: async () => currentRoot },
    })

    const result = await runWithWindowScope(101, () => service.getOverview())

    expect(result.overview).toMatchObject({
      identity: {
        projectName: 'gcd',
        workspaceId: 'ws_current',
        baselineWorkspaceId: 'ws_baseline',
      },
      configuration: { status: 'ready', data: { pdk: 'ics55', maxFanout: 32 } },
      flow: {
        status: 'ready',
        data: { steps: [{ state: 'succeeded' }, { state: 'succeeded' }] },
      },
      checklist: { status: 'ready' },
      qor: { status: 'ready' },
      baselineComparison: { status: 'ready' },
      flowInsights: { status: 'ready' },
      revision: {
        status: 'ready',
        data: { workspaceId: 'engineering-current', workspaceRevision: 7 },
      },
    })
    const { qor, keyMetrics, flowInsights } = result.overview
    if (
      qor.status !== 'ready' ||
      keyMetrics.status !== 'ready' ||
      flowInsights?.status !== 'ready'
    ) {
      throw new Error('expected committed Overview sections')
    }
    expect(qor.data.metrics).toContainEqual(
      expect.objectContaining({ id: 'instance_count', value: 450 }),
    )
    expect(keyMetrics.data.items).toContainEqual({
      id: 'core-area',
      label: 'Core Area',
      unit: 'um2',
      value: 6400,
    })
    expect(flowInsights.data.trends).toContainEqual(
      expect.objectContaining({
        id: 'instance_count',
        points: expect.arrayContaining([expect.objectContaining({ value: 450 })]),
      }),
    )

    const detail = await runWithWindowScope(101, () =>
      service.getStepDetail({
        stepId: 'Place',
        workspaceContextId: result.workspaceContextId,
        workspaceRevision: 7,
      }),
    )
    expect(detail).toMatchObject({
      workspaceRevision: 7,
      detail: {
        status: 'ready',
        data: {
          analysis: { database: { layout: { coreArea: 6400 } } },
          subflow: { status: 'available', steps: [{ name: 'placement' }] },
        },
      },
    })
  })
})
