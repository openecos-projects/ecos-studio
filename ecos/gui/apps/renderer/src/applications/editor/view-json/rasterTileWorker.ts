import ViewJsonRasterTileWorker from './rasterTile.worker?worker'
import type {
  ViewJsonRasterInstance,
  ViewJsonRasterTileWorkerFactory,
  ViewJsonRasterTileWorkerLike,
  ViewJsonRasterTileWorkerResponse,
} from './overviewData'

export interface ViewJsonRasterTileWorkerResult {
  tileX: number
  tileY: number
  bitmap: ImageBitmap
}

export const createViewJsonRasterTileWorker: ViewJsonRasterTileWorkerFactory = () =>
  new ViewJsonRasterTileWorker() as ViewJsonRasterTileWorkerLike

export class ViewJsonRasterTileWorkerClient {
  private readonly worker: ViewJsonRasterTileWorkerLike | null
  private readonly pending = new Map<number, {
    resolve: (result: ViewJsonRasterTileWorkerResult) => void
    reject: (error: Error) => void
  }>()
  private nextRequestId = 0

  constructor(workerFactory: ViewJsonRasterTileWorkerFactory) {
    this.worker = workerFactory()
    if (!this.worker) return

    this.worker.onmessage = (event) => {
      this.handleMessage(event.data)
    }
    this.worker.onerror = (event) => {
      this.rejectAll(new Error(event.message || 'View JSON raster tile worker failed.'))
    }
  }

  get available(): boolean {
    return this.worker !== null
  }

  renderTile(
    tileX: number,
    tileY: number,
    rasterInstances: ViewJsonRasterInstance[],
  ): Promise<ViewJsonRasterTileWorkerResult> {
    if (!this.worker) {
      return Promise.reject(new Error('View JSON raster tile worker is not available.'))
    }

    const id = this.nextRequestId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker?.postMessage({
        id,
        type: 'render-view-json-raster-tile',
        tileX,
        tileY,
        rasterInstances,
      })
    })
  }

  destroy(): void {
    this.rejectAll(new Error('View JSON raster tile worker was destroyed.'))
    this.worker?.terminate()
  }

  private handleMessage(message: ViewJsonRasterTileWorkerResponse): void {
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)

    if (!message.ok) {
      pending.reject(new Error(message.error))
      return
    }

    pending.resolve({
      tileX: message.tileX,
      tileY: message.tileY,
      bitmap: message.bitmap,
    })
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}
