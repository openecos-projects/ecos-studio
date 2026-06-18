import ViewJsonSemanticOverviewWorker from './semanticOverview.worker?worker'
import type {
  ViewJsonPackageData,
  ViewJsonRenderModel,
} from './types'
import type {
  ViewJsonSemanticOverviewLevel,
  ViewJsonSemanticOverviewWorkerClientLike,
} from './semanticOverview'

export type ViewJsonSemanticOverviewWorkerRequest =
  | {
    id: number
    type: 'build-view-json-semantic-overview'
    model: ViewJsonRenderModel
    data: ViewJsonPackageData | null
    scale: number
  }
  | {
    id: number
    type: 'build-view-json-semantic-overview-from-package'
    data: ViewJsonPackageData
    scale: number
  }

export type ViewJsonSemanticOverviewWorkerResponse =
  | {
    id: number
    ok: true
    level: ViewJsonSemanticOverviewLevel
  }
  | {
    id: number
    ok: false
    error: string
  }

export interface ViewJsonSemanticOverviewWorkerLike {
  onmessage: ((event: MessageEvent<ViewJsonSemanticOverviewWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ViewJsonSemanticOverviewWorkerRequest): void
  terminate(): void
}

export type ViewJsonSemanticOverviewWorkerFactory = () => ViewJsonSemanticOverviewWorkerLike | null

export const createViewJsonSemanticOverviewWorker: ViewJsonSemanticOverviewWorkerFactory = () =>
  new ViewJsonSemanticOverviewWorker() as ViewJsonSemanticOverviewWorkerLike

function packageDataForSemanticOverview(data: ViewJsonPackageData): ViewJsonPackageData {
  if (!data.overview?.routing?.length) return data
  return {
    ...data,
    regularWires: [],
    specialWires: [],
  }
}

export class ViewJsonSemanticOverviewWorkerClient implements ViewJsonSemanticOverviewWorkerClientLike {
  private worker: ViewJsonSemanticOverviewWorkerLike | null
  private readonly pending = new Map<number, {
    resolve: (level: ViewJsonSemanticOverviewLevel) => void
    reject: (error: Error) => void
  }>()
  private nextRequestId = 0
  private destroyed = false
  private readonly workerFactory: ViewJsonSemanticOverviewWorkerFactory

  constructor(workerFactory: ViewJsonSemanticOverviewWorkerFactory) {
    this.workerFactory = workerFactory
    this.worker = this.createWorker()
  }

  get available(): boolean {
    return this.worker !== null
  }

  buildLevel(
    model: ViewJsonRenderModel,
    data: ViewJsonPackageData | null,
    scale: number,
  ): Promise<ViewJsonSemanticOverviewLevel> {
    const worker = this.ensureWorker()
    if (!worker) {
      return Promise.reject(new Error('View JSON semantic overview worker is not available.'))
    }

    const id = this.nextRequestId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({
        id,
        type: 'build-view-json-semantic-overview',
        model,
        data,
        scale,
      })
    })
  }

  buildLevelFromPackage(
    data: ViewJsonPackageData,
    scale: number,
  ): Promise<ViewJsonSemanticOverviewLevel> {
    const worker = this.ensureWorker()
    if (!worker) {
      return Promise.reject(new Error('View JSON semantic overview worker is not available.'))
    }

    const id = this.nextRequestId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({
        id,
        type: 'build-view-json-semantic-overview-from-package',
        data: packageDataForSemanticOverview(data),
        scale,
      })
    })
  }

  cancelPending(): void {
    if (this.pending.size === 0) return
    this.rejectAll(new Error('View JSON semantic overview worker request was cancelled.'))
    this.worker?.terminate()
    this.worker = null
  }

  destroy(): void {
    this.destroyed = true
    this.rejectAll(new Error('View JSON semantic overview worker was destroyed.'))
    this.worker?.terminate()
    this.worker = null
  }

  private createWorker(): ViewJsonSemanticOverviewWorkerLike | null {
    const worker = this.workerFactory()
    if (!worker) return null
    worker.onmessage = (event) => {
      this.handleMessage(event.data)
    }
    worker.onerror = (event) => {
      this.rejectAll(new Error(event.message || 'View JSON semantic overview worker failed.'))
      worker.terminate()
      if (this.worker === worker) this.worker = null
    }
    return worker
  }

  private ensureWorker(): ViewJsonSemanticOverviewWorkerLike | null {
    if (this.destroyed) return null
    if (!this.worker) this.worker = this.createWorker()
    return this.worker
  }

  private handleMessage(message: ViewJsonSemanticOverviewWorkerResponse): void {
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)

    if (!message.ok) {
      pending.reject(new Error(message.error))
      return
    }

    pending.resolve(message.level)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}
