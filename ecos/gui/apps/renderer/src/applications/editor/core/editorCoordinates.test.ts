import { describe, it, expect } from 'vitest'
import { edaBBoxToWorldRect, displayPointFromWorld } from '@/applications/editor/core/editorCoordinates'

describe('edaBBoxToWorldRect', () => {
  it('maps EDA lower-left / upper-right to Pixi top-left rect', () => {
    const dieH = 10_000
    const r = edaBBoxToWorldRect(100, 200, 150, 250, dieH)
    expect(r).toEqual({ x: 100, y: dieH - 250, w: 50, h: 50 })
    const centerW = r.x + r.w / 2
    const centerWy = r.y + r.h / 2
    const disp = displayPointFromWorld(centerW, centerWy, dieH)
    expect(disp.x).toBe(125)
    expect(disp.y).toBe(225)
  })
})
