import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceResourceIndex, WorkspaceStepResource } from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  getWorkspaceResourceIndexApi: vi.fn(),
  readOptionalProjectTextFile: vi.fn(),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
  resourceVersions: null as Ref<{
    home: number
    parameters: number
    step: number
    all: number
  }> | null,
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    resourceVersions: testState.resourceVersions,
  }),
}))

vi.mock('@/api/workspaceResources', () => ({
  getWorkspaceResourceIndexApi: testState.getWorkspaceResourceIndexApi,
}))

vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFile: testState.readOptionalProjectTextFile,
}))

vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess: testState.resolveProjectPathAccess,
}))

import { useDashboardOverview } from './useDashboardOverview'

const ANALYSIS_PATH = '/workspace/Floorplan_ecc/analysis/qor_metrics.json'
const DB_FEATURE_PATH = '/workspace/Floorplan_ecc/feature/Floorplan.db.json'
const STA_ANALYSIS_PATH = '/workspace/Sta_ecc/analysis/qor_metrics.json'
const ROUTE_STEP_FEATURE_PATH = '/workspace/Route_ecc/feature/route.step.json'

function workspaceStep(): WorkspaceStepResource {
  return {
    name: 'Floorplan',
    tool: 'ecc',
    state: 'Success',
    runtime: '0:0:1',
    directory: '/workspace/Floorplan_ecc',
    info: {},
    resources: {
      output: {},
      data: {},
      feature: {
        db: { exists: true, kind: 'analysis', path: DB_FEATURE_PATH },
      },
      report: {},
      log: {},
      script: {},
      analysis: {
        metrics: { exists: true, kind: 'metrics', path: ANALYSIS_PATH },
      },
      subflow: {},
      checklist: {},
      config: {},
    },
  }
}

function workspaceIndex(
  parameters: WorkspaceResourceIndex['parameters'] = null,
): WorkspaceResourceIndex {
  return {
    root: '/workspace',
    design: 'demo',
    topModule: 'demo',
    pdk: 'demo',
    home: {
      homeJson: { exists: true, kind: 'home', path: '/workspace/home/home.json' },
      flowJson: { exists: true, kind: 'flow', path: '/workspace/home/flow.json' },
      parametersJson: {
        exists: true,
        kind: 'parameters',
        path: '/workspace/home/parameters.json',
      },
      checklistJson: {
        exists: true,
        kind: 'checklist',
        path: '/workspace/home/checklist.json',
      },
    },
    homeData: null,
    parameters,
    flow: { steps: [workspaceStep()] },
    status: 'available',
    messages: [],
  }
}

function stepWith(
  name: string,
  state: string,
  directory: string,
  options: {
    analysisPath?: string
    dbPath?: string
    dbExists?: boolean
    stepPath?: string
  } = {},
): WorkspaceStepResource {
  return {
    name,
    tool: 'ecc',
    state,
    runtime: '0:0:1',
    directory,
    info: {},
    resources: {
      output: {},
      data: {},
      feature: {
        ...(options.dbPath
          ? {
              db: {
                exists: options.dbExists ?? true,
                kind: 'analysis',
                path: options.dbPath,
              },
            }
          : {}),
        ...(options.stepPath
          ? { step: { exists: true, kind: 'analysis', path: options.stepPath } }
          : {}),
      },
      report: {},
      log: {},
      script: {},
      analysis: options.analysisPath
        ? { metrics: { exists: true, kind: 'metrics', path: options.analysisPath } }
        : {},
      subflow: {},
      checklist: {},
      config: {},
    },
  }
}

describe('useDashboardOverview db feature metrics', () => {
  let scope: EffectScope

  beforeEach(() => {
    scope = effectScope()
    testState.currentProject = ref({ path: '/workspace' })
    testState.resourceVersions = ref({ home: 0, parameters: 0, step: 0, all: 0 })
    testState.getWorkspaceResourceIndexApi.mockReset()
    testState.readOptionalProjectTextFile.mockReset()
    testState.resolveProjectPathAccess.mockClear()
    testState.getWorkspaceResourceIndexApi.mockResolvedValue(workspaceIndex())
    testState.readOptionalProjectTextFile.mockImplementation(async (path: string) => {
      if (path === ANALYSIS_PATH) {
        return JSON.stringify({
          metrics: [
            { id: 'instance_count', value: 423 },
            { id: 'die_area', value: 2313.42 },
          ],
        })
      }
      if (
        path === `${ANALYSIS_PATH.slice(0, -'qor_metrics.json'.length)}qor_summary.json`
      ) {
        return JSON.stringify({
          schema_version: 4,
          quality_status: 'pass',
          metric_count: 10,
          gates: [],
        })
      }
      if (path === DB_FEATURE_PATH) {
        return JSON.stringify({
          Instances: {
            macros: { num: 3, area: 41.25 },
            logic: { num: 316, area: 803.04 },
            iopads: { num: 54 },
          },
        })
      }
      return null
    })
  })

  afterEach(() => {
    scope.stop()
  })

  it('loads Floorplan db feature metrics into Key Metrics after Instance Number', async () => {
    const overview = scope.run(() => useDashboardOverview())!

    await vi.waitFor(() => {
      expect(overview.qorSteps.value).toHaveLength(1)
    })

    const metric = (id: string) =>
      overview.keyMetrics.value.find((entry) => entry.id === id)
    expect(metric('instances')?.value).toBe(423)
    expect(metric('macro-number')?.value).toBe(3)
    expect(metric('macro-area')?.value).toBe(41.25)
    expect(metric('std-cell-number')?.value).toBe(316)
    expect(metric('std-cell-area')?.value).toBe(803.04)
    expect(metric('io-pad-number')?.value).toBe(54)
    expect(overview.qorSteps.value[0]).toMatchObject({
      blockedCount: 0,
      passCount: 1,
      summaryMetricCount: 10,
      totalCount: 1,
    })
    expect(testState.readOptionalProjectTextFile).toHaveBeenCalledWith(DB_FEATURE_PATH)
  })

  it('exposes MPC display name and max fanout from Home parameters', async () => {
    testState.getWorkspaceResourceIndexApi.mockResolvedValue(
      workspaceIndex({
        'Max fanout': 32,
        MPC: { display_name: 'MPC Frame' },
      }),
    )
    const overview = scope.run(() => useDashboardOverview())!

    await vi.waitFor(() => {
      expect(overview.mpcDisplayName.value).toBe('MPC Frame')
    })

    expect(overview.maxFanout.value).toBe(32)
  })

  it('falls back to the previous successful step feature when the current step has no db', async () => {
    const route = stepWith('Route', 'Success', '/workspace/Route_ecc', {
      stepPath: ROUTE_STEP_FEATURE_PATH,
    })
    const sta = stepWith('STA', 'Success', '/workspace/Sta_ecc', {
      analysisPath: STA_ANALYSIS_PATH,
      dbPath: '/workspace/Sta_ecc/feature/STA.db.json',
      dbExists: false,
    })
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      ...workspaceIndex(),
      flow: { steps: [route, sta] },
    })
    testState.readOptionalProjectTextFile.mockImplementation(async (path: string) => {
      if (path === STA_ANALYSIS_PATH) {
        return JSON.stringify({ metrics: [{ id: 'sta_setup_wns', value: -0.12 }] })
      }
      if (
        path ===
        `${STA_ANALYSIS_PATH.slice(0, -'qor_metrics.json'.length)}qor_summary.json`
      ) {
        return JSON.stringify({ quality_status: 'pass', metric_count: 1 })
      }
      if (path === ROUTE_STEP_FEATURE_PATH) {
        return JSON.stringify({
          route: { instance_cnt: 432, total_pins: 54, net_cnt: 777 },
        })
      }
      return null
    })

    const overview = scope.run(() => useDashboardOverview())!
    await vi.waitFor(() => {
      expect(overview.qorSteps.value).toHaveLength(2)
    })

    const metric = (id: string) =>
      overview.keyMetrics.value.find((entry) => entry.id === id)
    expect(metric('setup-wns')?.value).toBe(-0.12)
    expect(metric('instances')?.value).toBe(432)
    expect(metric('io-pins')?.value).toBe(54)
    expect(metric('nets')?.value).toBe(777)
    expect(testState.readOptionalProjectTextFile).toHaveBeenCalledWith(
      ROUTE_STEP_FEATURE_PATH,
    )
  })

  it('prefers the current step db over a previous step feature fallback', async () => {
    const route = stepWith('Route', 'Success', '/workspace/Route_ecc', {
      stepPath: ROUTE_STEP_FEATURE_PATH,
    })
    const staDbPath = '/workspace/Sta_ecc/feature/STA.db.json'
    const sta = stepWith('STA', 'Success', '/workspace/Sta_ecc', {
      analysisPath: STA_ANALYSIS_PATH,
      dbPath: staDbPath,
      dbExists: true,
    })
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      ...workspaceIndex(),
      flow: { steps: [route, sta] },
    })
    testState.readOptionalProjectTextFile.mockImplementation(async (path: string) => {
      if (path === STA_ANALYSIS_PATH) {
        return JSON.stringify({ metrics: [{ id: 'sta_setup_wns', value: -0.12 }] })
      }
      if (
        path ===
        `${STA_ANALYSIS_PATH.slice(0, -'qor_metrics.json'.length)}qor_summary.json`
      ) {
        return JSON.stringify({ quality_status: 'pass', metric_count: 1 })
      }
      if (path === staDbPath) {
        return JSON.stringify({
          Instances: { macros: { num: 9 }, logic: { num: 800 }, iopads: { num: 21 } },
        })
      }
      if (path === ROUTE_STEP_FEATURE_PATH) {
        return JSON.stringify({ route: { instance_cnt: 432, total_pins: 54 } })
      }
      return null
    })

    const overview = scope.run(() => useDashboardOverview())!
    await vi.waitFor(() => {
      expect(overview.qorSteps.value).toHaveLength(2)
    })

    const metric = (id: string) =>
      overview.keyMetrics.value.find((entry) => entry.id === id)
    expect(metric('macro-number')?.value).toBe(9)
    expect(metric('std-cell-number')?.value).toBe(800)
    expect(metric('io-pad-number')?.value).toBe(21)
    expect(testState.readOptionalProjectTextFile).not.toHaveBeenCalledWith(
      ROUTE_STEP_FEATURE_PATH,
    )
  })
})
