import { describe, expect, it, vi } from 'vitest'
import type {
  ViewJsonRasterInstance,
  ViewJsonRasterTileWorkerRequest,
} from './overviewData'
import {
  ViewJsonRasterTileWorkerClient,
  createViewJsonRasterTileWorker,
} from './rasterTileWorker'
import source from './rasterTile.worker.ts?raw'
import factorySource from './rasterTileWorker.ts?raw'

function makeRasterInstance(id: number): ViewJsonRasterInstance {
  return {
    id,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    status: 'PLACED',
  }
}

describe('ViewJsonRasterTileWorkerClient', () => {
  it('renders a raster tile through a worker request', async () => {
    const bitmap = { width: 512, height: 512 } as ImageBitmap
    let postedMessage: ViewJsonRasterTileWorkerRequest | null = null
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      postMessage: vi.fn((message: ViewJsonRasterTileWorkerRequest) => {
        postedMessage = message
        worker.onmessage?.({
          data: {
            id: message.id,
            ok: true,
            tileX: message.tileX,
            tileY: message.tileY,
            bitmap,
          },
        } as MessageEvent)
      }),
      terminate: vi.fn(),
    }
    const client = new ViewJsonRasterTileWorkerClient(() => worker)

    await expect(client.renderTile(2, 3, [makeRasterInstance(1)])).resolves.toEqual({
      tileX: 2,
      tileY: 3,
      bitmap,
    })
    expect(postedMessage).toMatchObject({
      type: 'render-view-json-raster-tile',
      tileX: 2,
      tileY: 3,
      rasterInstances: [makeRasterInstance(1)],
    })
    client.destroy()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('rejects when the raster tile worker reports an error', async () => {
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      postMessage: vi.fn((message: ViewJsonRasterTileWorkerRequest) => {
        worker.onmessage?.({
          data: {
            id: message.id,
            ok: false,
            error: 'no offscreen canvas',
          },
        } as MessageEvent)
      }),
      terminate: vi.fn(),
    }
    const client = new ViewJsonRasterTileWorkerClient(() => worker)

    await expect(client.renderTile(0, 0, [])).rejects.toThrow('no offscreen canvas')
    client.destroy()
  })
})

describe('raster tile worker module', () => {
  it('uses OffscreenCanvas and shared raster drawing logic', () => {
    expect(source).toContain('new OffscreenCanvas(')
    expect(source).toContain('drawViewJsonRasterTileToCanvasLike(')
    expect(source).toContain('transferToImageBitmap()')
    expect(source).toContain("from './rasterTileDrawing'")
    expect(source).not.toContain("from './overview'")
  })

  it('exposes a Vite worker factory', () => {
    expect(factorySource).toContain("from './rasterTile.worker?worker'")
    expect(createViewJsonRasterTileWorker).toBeTypeOf('function')
  })
})
