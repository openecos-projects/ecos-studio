import { edaBBoxToWorldRect } from '@/applications/editor/core/editorCoordinates'
import type {
  TechBBox,
  TechCellMaster,
  TechPreviewGeometry,
  TechPreviewRect,
  TechViaMaster,
} from './types'

function emptyGeometry(): TechPreviewGeometry {
  return { bounds: { x: 0, y: 0, w: 0, h: 0 }, rects: [] }
}

function unionBbox(rects: TechBBox[]): TechBBox | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rect of rects) {
    minX = Math.min(minX, rect[0], rect[2])
    minY = Math.min(minY, rect[1], rect[3])
    maxX = Math.max(maxX, rect[0], rect[2])
    maxY = Math.max(maxY, rect[1], rect[3])
  }
  return [minX, minY, maxX, maxY]
}

function normalizeRect(rect: TechBBox, bbox: TechBBox): TechBBox {
  return [
    rect[0] - bbox[0],
    rect[1] - bbox[1],
    rect[2] - bbox[0],
    rect[3] - bbox[1],
  ]
}

export function buildCellPreviewGeometry(cell: TechCellMaster): TechPreviewGeometry {
  const worldHeight = cell.size[1]
  const rects: TechPreviewRect[] = []

  for (const pin of cell.pins) {
    for (const port of pin.ports) {
      for (const rect of port.rects) {
        rects.push({
          layerId: port.layer_id,
          kind: 'pin',
          name: pin.name,
          world: edaBBoxToWorldRect(rect[0], rect[1], rect[2], rect[3], worldHeight),
        })
      }
    }
  }

  for (const obs of cell.obs) {
    for (const rect of obs.rects) {
      rects.push({
        layerId: obs.layer_id,
        kind: 'obs',
        name: 'OBS',
        world: edaBBoxToWorldRect(rect[0], rect[1], rect[2], rect[3], worldHeight),
      })
    }
  }

  return {
    bounds: { x: 0, y: 0, w: cell.size[0], h: cell.size[1] },
    rects,
  }
}

export function buildViaPreviewGeometry(via: TechViaMaster): TechPreviewGeometry {
  const sourceRects = via.shapes.flatMap((shape) => shape.rects)
  const bbox = unionBbox(sourceRects)
  if (!bbox) return emptyGeometry()

  const worldHeight = bbox[3] - bbox[1]
  const rects: TechPreviewRect[] = []
  for (const shape of via.shapes) {
    for (const rect of shape.rects) {
      const normalized = normalizeRect(rect, bbox)
      rects.push({
        layerId: shape.layer_id,
        kind: 'via',
        name: via.name,
        world: edaBBoxToWorldRect(
          normalized[0],
          normalized[1],
          normalized[2],
          normalized[3],
          worldHeight,
        ),
      })
    }
  }

  return {
    bounds: { x: 0, y: 0, w: bbox[2] - bbox[0], h: worldHeight },
    rects,
  }
}
