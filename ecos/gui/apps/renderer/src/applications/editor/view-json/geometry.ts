import { edaBBoxToWorldRect } from '@/applications/editor/core/editorCoordinates'
import type {
  ViewJsonBBox,
  ViewJsonOrient,
  ViewJsonPoint,
  ViewJsonWorldPoint,
  ViewJsonWorldRect,
} from './types'

export interface ViewJsonPlacedTransform {
  origin: ViewJsonPoint
  width: number
  height: number
  orient?: ViewJsonOrient
}

export function edaPointToWorldPoint(
  point: ViewJsonPoint,
  worldHeight: number,
): ViewJsonWorldPoint {
  return {
    x: point[0],
    y: worldHeight - point[1],
  }
}

export function edaRectToWorldRect(
  rect: ViewJsonBBox,
  worldHeight: number,
): ViewJsonWorldRect {
  return edaBBoxToWorldRect(rect[0], rect[1], rect[2], rect[3], worldHeight)
}

export function normalizeViewJsonOrient(orient: ViewJsonOrient | null | undefined): string {
  switch ((orient ?? 'N_R0').toUpperCase()) {
    case 'N':
      return 'N_R0'
    case 'S':
      return 'S_R180'
    case 'W':
      return 'W_R90'
    case 'E':
      return 'E_R270'
    case 'FN':
      return 'FN_MY'
    case 'FS':
      return 'FS_MX'
    case 'FW':
      return 'FW_MX90'
    case 'FE':
      return 'FE_MY90'
    default:
      return (orient ?? 'N_R0').toUpperCase()
  }
}

export function transformLocalPoint(
  localPoint: ViewJsonPoint,
  transform: ViewJsonPlacedTransform,
): ViewJsonPoint {
  const [x, y] = localPoint
  const [ox, oy] = transform.origin
  const w = transform.width
  const h = transform.height

  switch (normalizeViewJsonOrient(transform.orient)) {
    case 'S_R180':
      return [ox + w - x, oy + h - y]
    case 'W_R90':
      return [ox + h - y, oy + x]
    case 'E_R270':
      return [ox + y, oy + w - x]
    case 'FN_MY':
      return [ox + w - x, oy + y]
    case 'FS_MX':
      return [ox + x, oy + h - y]
    case 'FW_MX90':
      return [ox + y, oy + x]
    case 'FE_MY90':
      return [ox + h - y, oy + w - x]
    case 'N_R0':
    default:
      return [ox + x, oy + y]
  }
}

export function materializeLocalRect(
  localRect: ViewJsonBBox,
  transform: ViewJsonPlacedTransform,
): ViewJsonBBox {
  const low = transformLocalPoint([localRect[0], localRect[1]], transform)
  const high = transformLocalPoint([localRect[2], localRect[3]], transform)
  return [
    Math.min(low[0], high[0]),
    Math.min(low[1], high[1]),
    Math.max(low[0], high[0]),
    Math.max(low[1], high[1]),
  ]
}

export function materializeMasterLocalRect(
  localRect: ViewJsonBBox,
  transform: ViewJsonPlacedTransform,
  masterOrigin?: ViewJsonPoint | null,
): ViewJsonBBox {
  const [originX, originY] = masterOrigin ?? [0, 0]
  return materializeLocalRect(
    [
      localRect[0] - originX,
      localRect[1] - originY,
      localRect[2] - originX,
      localRect[3] - originY,
    ],
    transform,
  )
}

export function translateLocalRect(
  localRect: ViewJsonBBox,
  origin: ViewJsonPoint,
): ViewJsonBBox {
  return [
    localRect[0] + origin[0],
    localRect[1] + origin[1],
    localRect[2] + origin[0],
    localRect[3] + origin[1],
  ]
}

export function deriveBBoxFromRects(rects: ViewJsonBBox[]): ViewJsonBBox | null {
  if (rects.length === 0) return null
  let lx = Number.POSITIVE_INFINITY
  let ly = Number.POSITIVE_INFINITY
  let ux = Number.NEGATIVE_INFINITY
  let uy = Number.NEGATIVE_INFINITY

  for (const rect of rects) {
    lx = Math.min(lx, rect[0], rect[2])
    ly = Math.min(ly, rect[1], rect[3])
    ux = Math.max(ux, rect[0], rect[2])
    uy = Math.max(uy, rect[1], rect[3])
  }

  return [lx, ly, ux, uy]
}

export function normalizeBBox(rect: ViewJsonBBox): ViewJsonBBox {
  return [
    Math.min(rect[0], rect[2]),
    Math.min(rect[1], rect[3]),
    Math.max(rect[0], rect[2]),
    Math.max(rect[1], rect[3]),
  ]
}
