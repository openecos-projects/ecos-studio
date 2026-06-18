import { describe, expect, it } from 'vitest'
import { buildViewJsonRenderModelAsync } from './renderModel'
import type { ViewJsonPackageData } from './types'

describe('view-json render model memory guards', () => {
  it('yields while building large guide sets', async () => {
    let idleCount = 0
    await buildViewJsonRenderModelAsync(createGuideHeavyPackageData(), {
      batchSize: 10,
      requestIdle: async () => {
        idleCount += 1
      },
    })

    expect(idleCount).toBeGreaterThan(1)
  })
})

function createGuideHeavyPackageData(): ViewJsonPackageData {
  const layer = { id: 1, name: 'M1' }
  return {
    manifest: {
      schema: 'ieda.view.v1',
      format: 'layout_view_package',
      files: {},
    },
    dbuPerMicron: 1000,
    die: {
      die_area: [0, 0, 1000, 1000],
    },
    worldWidth: 1000,
    worldHeight: 1000,
    layers: [layer],
    vias: [],
    cellMasters: [],
    rows: [],
    tracks: [{
      id: 1,
      direction: 'X',
      start: 0,
      step: 1,
      count: 100,
      layer_id: 1,
    }],
    gcellGrids: [{
      id: 1,
      direction: 'Y',
      start: 0,
      step: 1,
      count: 100,
    }],
    instances: [],
    ioPins: [],
    regularWires: [],
    specialWires: [],
    blockages: [],
    fills: [],
    regions: [],
    layerById: new Map([[1, layer]]),
    viaById: new Map(),
    cellMasterById: new Map(),
    overview: {
      routing: [],
      countsByObjectKind: {},
    },
    routingDetailAvailable: false,
    loadStats: {
      readMs: 0,
      parseMs: 0,
      transformMs: 0,
      chunkMs: 0,
      totalMs: 0,
    },
  }
}
