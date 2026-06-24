import { describe, expect, it } from 'vitest'
import {
  buildTechPreviewRenderGroups,
  colorForTechLayer,
} from './previewRendering'
import type { TechLayer, TechPreviewGeometry } from './types'

const layers: TechLayer[] = [
  { id: 7, name: 'MET1', type: 'ROUTING', order: 7, direction: 'HORIZONTAL' },
  { id: 8, name: 'VIA1', type: 'CUT', order: 8, direction: 'none' },
]

describe('tech preview rendering', () => {
  it('groups same layer geometry into one fill pass', () => {
    const geometry: TechPreviewGeometry = {
      bounds: { x: 0, y: 0, w: 120, h: 120 },
      rects: [
        { layerId: 7, kind: 'pin', name: 'A', world: { x: 0, y: 0, w: 80, h: 80 } },
        { layerId: 7, kind: 'pin', name: 'B', world: { x: 40, y: 40, w: 80, h: 80 } },
        { layerId: 7, kind: 'obs', name: 'OBS', world: { x: 20, y: 20, w: 20, h: 20 } },
      ],
    }

    const groups = buildTechPreviewRenderGroups(geometry, layers)

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      key: '7:pin',
      layerId: 7,
      kind: 'pin',
      rects: [geometry.rects[0], geometry.rects[1]],
    })
    expect(groups[1]).toMatchObject({
      key: '7:obs',
      layerId: 7,
      kind: 'obs',
      rects: [geometry.rects[2]],
    })
  })

  it('decomposes same-style overlaps into non-overlapping draw rects', () => {
    const geometry: TechPreviewGeometry = {
      bounds: { x: 0, y: 0, w: 120, h: 120 },
      rects: [
        { layerId: 7, kind: 'pin', name: 'A', world: { x: 0, y: 0, w: 80, h: 80 } },
        { layerId: 7, kind: 'pin', name: 'B', world: { x: 40, y: 40, w: 80, h: 80 } },
      ],
    }

    const [group] = buildTechPreviewRenderGroups(geometry, layers)

    expect(group.drawRects).toEqual([
      { x: 0, y: 0, w: 80, h: 40 },
      { x: 0, y: 40, w: 120, h: 40 },
      { x: 40, y: 80, w: 80, h: 40 },
    ])
  })

  it('uses the ECOS layer palette for known layers', () => {
    expect(colorForTechLayer(layers[0], 0)).toBe(0x4444ff)
    expect(colorForTechLayer(layers[1], 1)).toBe(0xaaaaaa)
  })
})
