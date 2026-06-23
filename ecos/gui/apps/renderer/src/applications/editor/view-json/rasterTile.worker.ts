import {
  VIEW_JSON_RASTER_TILE_PIXEL_SIZE,
  type ViewJsonRasterTileWorkerRequest,
  type ViewJsonRasterTileWorkerResponse,
} from './overviewData'
import { drawViewJsonRasterTileToCanvasLike } from './rasterTileDrawing'

interface ViewJsonRasterTileWorkerScope {
  onmessage: ((event: MessageEvent<ViewJsonRasterTileWorkerRequest>) => void) | null
  postMessage(message: ViewJsonRasterTileWorkerResponse, transfer?: Transferable[]): void
}

const workerScope = self as unknown as ViewJsonRasterTileWorkerScope

workerScope.onmessage = (event: MessageEvent<ViewJsonRasterTileWorkerRequest>) => {
  const message = event.data
  if (message.type !== 'render-view-json-raster-tile') return

  try {
    const canvas = new OffscreenCanvas(
      VIEW_JSON_RASTER_TILE_PIXEL_SIZE,
      VIEW_JSON_RASTER_TILE_PIXEL_SIZE,
    )
    drawViewJsonRasterTileToCanvasLike(
      canvas,
      message.tileX,
      message.tileY,
      message.rasterInstances,
    )
    const bitmap = canvas.transferToImageBitmap()
    workerScope.postMessage({
      id: message.id,
      ok: true,
      tileX: message.tileX,
      tileY: message.tileY,
      bitmap,
    } satisfies ViewJsonRasterTileWorkerResponse, [bitmap])
  } catch (error: unknown) {
    workerScope.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ViewJsonRasterTileWorkerResponse)
  }
}
