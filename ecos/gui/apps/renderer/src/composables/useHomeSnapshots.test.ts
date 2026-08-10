import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type Ref } from 'vue'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  resourceVersions: null as Ref<{
    flow: number
    step: number
    maps: number
    all: number
  }> | null,
  getWorkspaceResourceIndexApi: vi.fn(),
  readOptionalProjectTextFile: vi.fn(),
  readProjectBlobUrl: vi.fn(),
  resolveProjectPathAccess: vi.fn(),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    resourceVersions: testState.resourceVersions,
  }),
}))

vi.mock('./useDesktopRuntime', () => ({
  useDesktopRuntime: () => ({ isDesktopRuntimeAvailable: true }),
}))

vi.mock('@/api/workspaceResources', () => ({
  getWorkspaceResourceIndexApi: testState.getWorkspaceResourceIndexApi,
}))

vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFile: testState.readOptionalProjectTextFile,
  readProjectBlobUrl: testState.readProjectBlobUrl,
}))

vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess: testState.resolveProjectPathAccess,
}))

import { clearHomeSnapshotCache, useHomeSnapshots } from './useHomeSnapshots'

function resource(path: string, exists = true) {
  return { path, exists, kind: 'analysis' as const, mtimeMs: 1, sizeBytes: 1 }
}

function step(
  name: string,
  state: string,
  directory: string,
  options: { db?: string; drcCsv?: string; image?: string } = {},
) {
  return {
    name,
    tool: 'ecc',
    state,
    runtime: '',
    directory,
    info: {},
    resources: {
      output: options.image ? { image: resource(options.image) } : {},
      data: {},
      feature: options.db ? { db: resource(options.db) } : {},
      report: {},
      log: {},
      script: {},
      analysis: options.drcCsv ? { statis_csv: resource(options.drcCsv) } : {},
      subflow: {},
      checklist: {},
      config: {},
    },
  }
}

const physicalDb = JSON.stringify({
  Instances: {},
  Pins: {
    pin_distribution: [
      { pin_num: 1, inst_num: 2, net_num: 3 },
      { pin_num: 2, inst_num: 4, net_num: 5 },
    ],
  },
  Layers: {
    cut_layers: [{ layer_name: 'VIA1', via_num: 7 }],
    routing_layers: [{ layer_name: 'M1', wire_len: 12 }],
  },
})

describe('useHomeSnapshots', () => {
  beforeEach(() => {
    clearHomeSnapshotCache()
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.resourceVersions = ref({ flow: 0, step: 0, maps: 0, all: 0 })
    testState.getWorkspaceResourceIndexApi.mockReset()
    testState.readOptionalProjectTextFile.mockReset()
    testState.readProjectBlobUrl.mockReset()
    testState.resolveProjectPathAccess.mockReset()
    testState.resolveProjectPathAccess.mockImplementation(async (path: string) => path)
    testState.readProjectBlobUrl.mockImplementation(
      async (path: string) => `blob:${path}`,
    )
    testState.readOptionalProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('.db.json')) return physicalDb
      if (path.endsWith('drc_statis.csv')) {
        return 'Type,M1,M2,Total\nSpacing,2,3,5\nTotal,2,3,5'
      }
      return null
    })
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      root: '/workspace/demo',
      flow: {
        steps: [
          step('Synthesis', 'Success', '/workspace/demo/Synthesis_yosys'),
          step('Floorplan', 'Success', '/workspace/demo/Floorplan_ecc', {
            db: '/workspace/demo/Floorplan_ecc/feature/Floorplan.db.json',
            image: '/workspace/demo/Floorplan_ecc/output/floorplan.png',
          }),
          step('place', 'Success', '/workspace/demo/place_dreamplace', {
            db: '/workspace/demo/place_dreamplace/feature/place.db.json',
            image: '/workspace/demo/place_dreamplace/output/place.png',
          }),
          step('drc', 'Success', '/workspace/demo/drc_ecc', {
            drcCsv: '/workspace/demo/drc_ecc/analysis/drc_statis.csv',
            image: '/workspace/demo/drc_ecc/output/drc.png',
          }),
          step('Harden', 'Success', '/workspace/demo/Harden_ecc', {
            image: '/workspace/demo/Harden_ecc/output/harden.png',
          }),
        ],
      },
    })
  })

  it('collects successful layouts with the newest physical data and DRC snapshots', async () => {
    const scope = effectScope()
    const snapshots = scope.run(() => useHomeSnapshots())!

    await vi.waitFor(() => {
      expect(snapshots.items.value).toHaveLength(11)
    })

    expect(snapshots.items.value.map((item) => item.label)).toEqual([
      'Floorplan Layout',
      'place Layout',
      'drc Layout',
      'Harden Layout',
      'place Instance Distribution',
      'Net Pin Bins',
      'Cut Layer Vias',
      'Routing Wire Length',
      'Place All Cell Density',
      'Layer Totals',
      'Type Totals',
    ])
    expect(
      snapshots.items.value.find((item) => item.id === 'physical-instance-distribution'),
    ).toMatchObject({
      path: '/workspace/demo/place_dreamplace/feature/place.db.inst_dist.png',
    })
    expect(
      snapshots.items.value.find((item) => item.id === 'place-pin-distribution-net_num'),
    ).toMatchObject({ kind: 'distribution', sourceStep: 'place' })

    scope.stop()
  })

  it('reuses cached Blob URLs when a resource refresh has no new artifacts', async () => {
    const scope = effectScope()
    const snapshots = scope.run(() => useHomeSnapshots())!

    await vi.waitFor(() => {
      expect(snapshots.items.value).not.toHaveLength(0)
    })
    const imageReadCount = testState.readProjectBlobUrl.mock.calls.length
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      all: 1,
    }

    await vi.waitFor(() => {
      expect(testState.getWorkspaceResourceIndexApi).toHaveBeenCalledTimes(2)
    })
    expect(testState.readProjectBlobUrl).toHaveBeenCalledTimes(imageReadCount)

    scope.stop()
  })
})
