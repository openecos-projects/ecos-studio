import { describe, expect, it, vi } from 'vitest'
import { ViewJsonPackageDataWorkerClient, type ViewJsonPackageDataWorkerRequest } from './packageData'
import { ViewJsonSemanticOverviewWorkerClient, type ViewJsonSemanticOverviewWorkerRequest } from './semanticOverviewWorker'
import type { ViewJsonRenderModel } from './types'

describe('view-json worker clients', () => {
  it('terminates and recreates semantic overview workers after cancellation', async () => {
    const firstWorker = createSemanticWorker()
    const secondWorker = createSemanticWorker()
    const workers = [firstWorker, secondWorker]
    const client = new ViewJsonSemanticOverviewWorkerClient(() => workers.shift() ?? null)
    const first = client.buildLevel(createRenderModel(), null, 1)

    client.cancelPending()
    await expect(first).rejects.toThrow('cancelled')

    const second = client.buildLevel(createRenderModel(), null, 2)

    expect(firstWorker.terminate).toHaveBeenCalledTimes(1)
    expect(secondWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ scale: 2 }))
    client.destroy()
    await expect(second).rejects.toThrow('destroyed')
  })

  it('terminates and recreates package data workers after cancellation', async () => {
    const firstWorker = createPackageWorker()
    const secondWorker = createPackageWorker()
    const workers = [firstWorker, secondWorker]
    const client = new ViewJsonPackageDataWorkerClient(() => workers.shift() ?? null)
    const first = client.parseRoutingDetail({
      diePath: '/pkg/design/die.json',
      dieText: '{}',
    })

    client.cancelPending()
    await expect(first).rejects.toThrow('cancelled')

    const second = client.parseRoutingDetail({
      diePath: '/pkg/design/die.json',
      dieText: '{}',
    })

    expect(firstWorker.terminate).toHaveBeenCalledTimes(1)
    expect(secondWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'parse-view-json-routing-detail',
    }))
    client.destroy()
    await expect(second).rejects.toThrow('destroyed')
  })
})

function createSemanticWorker() {
  return {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: vi.fn((_message: ViewJsonSemanticOverviewWorkerRequest) => undefined),
    terminate: vi.fn(),
  }
}

function createPackageWorker() {
  return {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: vi.fn((_message: ViewJsonPackageDataWorkerRequest) => undefined),
    terminate: vi.fn(),
  }
}

function createRenderModel(): ViewJsonRenderModel {
  return {
    dbuPerMicron: 1000,
    worldWidth: 1000,
    worldHeight: 1000,
    layers: [],
    layerById: new Map(),
    rects: [],
    paths: [],
    guides: [],
    lazyGeometry: {
      cellInstances: [],
      vias: [],
    },
    countsByObjectKind: {
      die: 0,
      core: 0,
      rows: 0,
      tracks: 0,
      gcell_grids: 0,
      instances: 0,
      io_pins: 0,
      regular_wires: 0,
      special_wires: 0,
      vias: 0,
      blockages: 0,
      fills: 0,
      regions: 0,
      cell_pins: 0,
      cell_obs: 0,
    },
  }
}
