import { describe, expect, it } from 'vitest'
import {
  buildCellPreviewGeometry,
  buildViaPreviewGeometry,
} from './previewGeometry'
import type { TechCellMaster, TechViaMaster } from './types'

describe('tech preview geometry', () => {
  it('converts cell pin rectangles from EDA coordinates to Pixi world coordinates', () => {
    const cell: TechCellMaster = {
      id: 1,
      name: 'INVX1',
      type: 'CORE',
      origin: [0, 0],
      size: [800, 1400],
      site: 'core7',
      symmetry: [],
      pins: [
        {
          name: 'A',
          direction: 'INPUT',
          use: 'SIGNAL',
          ports: [{ layer_id: 7, rects: [[0, 0, 200, 100]] }],
        },
      ],
      obs: [],
    }

    const geometry = buildCellPreviewGeometry(cell)

    expect(geometry.bounds).toEqual({ x: 0, y: 0, w: 800, h: 1400 })
    expect(geometry.rects[0]).toMatchObject({
      layerId: 7,
      kind: 'pin',
      name: 'A',
      world: { x: 0, y: 1300, w: 200, h: 100 },
    })
  })

  it('normalizes via rectangles with negative coordinates while preserving relative geometry', () => {
    const via: TechViaMaster = {
      id: 0,
      name: 'MET2_MET1_VIA1_0',
      type: 'FIXED',
      is_default: true,
      cut_rows: 1,
      cut_cols: 1,
      shapes: [
        { layer_id: 7, rects: [[-50, -85, 50, 85]] },
        { layer_id: 8, rects: [[-45, -45, 45, 45]] },
      ],
    }

    const geometry = buildViaPreviewGeometry(via)

    expect(geometry.bounds).toEqual({ x: 0, y: 0, w: 100, h: 170 })
    expect(geometry.rects).toEqual([
      {
        layerId: 7,
        kind: 'via',
        name: 'MET2_MET1_VIA1_0',
        world: { x: 0, y: 0, w: 100, h: 170 },
      },
      {
        layerId: 8,
        kind: 'via',
        name: 'MET2_MET1_VIA1_0',
        world: { x: 5, y: 40, w: 90, h: 90 },
      },
    ])
  })
})
