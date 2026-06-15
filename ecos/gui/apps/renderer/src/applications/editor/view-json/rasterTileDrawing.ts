import {
  VIEW_JSON_RASTER_TILE_PIXEL_SIZE,
  VIEW_JSON_RASTER_TILE_WORLD_SIZE,
  type ViewJsonRasterInstance,
} from './overviewData'

export const VIEW_JSON_RASTER_PLACED_FILL_STYLE = 'rgb(191, 219, 254)'
export const VIEW_JSON_RASTER_FIXED_FILL_STYLE = 'rgb(254, 215, 170)'

export interface ViewJsonRasterCanvasLike {
  width: number
  height: number
  getContext(type: '2d'): ViewJsonRasterCanvasContextLike | null
}

export interface ViewJsonRasterCanvasContextLike {
  fillStyle: string | CanvasGradient | CanvasPattern
  imageSmoothingEnabled: boolean
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
}

export function getViewJsonRasterFillStyle(status: string): string {
  return status === 'FIXED'
    ? VIEW_JSON_RASTER_FIXED_FILL_STYLE
    : VIEW_JSON_RASTER_PLACED_FILL_STYLE
}

export function drawViewJsonRasterTileToCanvasLike(
  canvas: ViewJsonRasterCanvasLike,
  tileX: number,
  tileY: number,
  instances: ViewJsonRasterInstance[],
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const worldX = tileX * VIEW_JSON_RASTER_TILE_WORLD_SIZE
  const worldY = tileY * VIEW_JSON_RASTER_TILE_WORLD_SIZE
  const scale = VIEW_JSON_RASTER_TILE_PIXEL_SIZE / VIEW_JSON_RASTER_TILE_WORLD_SIZE

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false

  for (const inst of instances) {
    const localX = (inst.x - worldX) * scale
    const localY = (inst.y - worldY) * scale
    const localW = Math.max(1, inst.w * scale)
    const localH = Math.max(1, inst.h * scale)
    if (
      localX > canvas.width
      || localY > canvas.height
      || localX + localW < 0
      || localY + localH < 0
    ) {
      continue
    }
    ctx.fillStyle = getViewJsonRasterFillStyle(inst.status)
    ctx.fillRect(
      Math.floor(localX),
      Math.floor(localY),
      Math.ceil(localW),
      Math.ceil(localH),
    )
  }
}

export function sortViewJsonRasterInstancesForPaint(
  instances: ViewJsonRasterInstance[],
): ViewJsonRasterInstance[] {
  const placed: ViewJsonRasterInstance[] = []
  const fixed: ViewJsonRasterInstance[] = []

  for (const inst of instances) {
    if (inst.status === 'FIXED') {
      fixed.push(inst)
    } else {
      placed.push(inst)
    }
  }

  return [...placed, ...fixed]
}
