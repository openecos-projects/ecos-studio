import { describe, expect, it } from 'vitest'
import {
  aggregateViewJsonPathsForLowZoom,
  aggregateViewJsonRectsForLowZoom,
} from './rectBatch'
import type {
  ViewJsonPathRenderable,
  ViewJsonRectRenderable,
} from './types'

function rect(overrides: Partial<ViewJsonRectRenderable> = {}): ViewJsonRectRenderable {
  return {
    id: 'rect:1',
    objectKind: 'regular_wires',
    sourceId: 1,
    layerId: 1,
    eda: [0, 0, 1000, 5],
    world: { x: 0, y: 0, w: 1000, h: 5 },
    ...overrides,
  }
}

describe('view-json rectBatch aggregation', () => {
  it('does not explode a large overview rect into thousands of cells at high scale', () => {
    const result = aggregateViewJsonRectsForLowZoom([rect()], 1)

    expect(result).toHaveLength(1)
    expect(result[0]?.world).toEqual({ x: 0, y: 0, w: 1000, h: 5 })
  })

  it('does not explode a long overview path into thousands of cells at high scale', () => {
    const path: ViewJsonPathRenderable = {
      id: 'path:1',
      objectKind: 'regular_wires',
      sourceId: 1,
      layerId: 1,
      width: 1,
      edaPoints: [[0, 0], [5000, 0]],
      worldPoints: [{ x: 0, y: 0 }, { x: 5000, y: 0 }],
    }

    const result = aggregateViewJsonPathsForLowZoom([path], 1)

    expect(result).toHaveLength(1)
    expect(result[0]?.world.w).toBeGreaterThanOrEqual(5000)
    expect(result[0]?.world.h).toBeGreaterThan(0)
  })
})
