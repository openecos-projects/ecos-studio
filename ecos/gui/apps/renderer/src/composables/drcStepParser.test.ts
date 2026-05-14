import { describe, it, expect } from 'vitest'
import { parseDrcStepJson, violationToFitRect } from '@/composables/drcStepParser'

describe('parseDrcStepJson', () => {
  it('flattens distribution layers into violations with bbox', () => {
    const raw = {
      drc: {
        number: 2,
        distribution: {
          cut_short: {
            number: 1,
            layers: {
              MET1: {
                number: 1,
                list: [
                  {
                    net: ['a'],
                    inst: [],
                    llx: 100,
                    lly: 200,
                    urx: 150,
                    ury: 250,
                    required_size: 0,
                  },
                ],
              },
            },
          },
          metal_short: {
            number: 1,
            layers: {
              MET2: {
                number: 1,
                list: [
                  {
                    net: ['b', 'c'],
                    inst: [],
                    llx: 0,
                    lly: 0,
                    urx: 10,
                    ury: 5,
                    required_size: 0,
                  },
                ],
              },
            },
          },
        },
      },
    }
    const dieH = 1000
    const v = parseDrcStepJson(raw, dieH)
    expect(v).toHaveLength(2)
    // EDA (100,200)–(150,250) → 世界 y = dieH - ury = 750, h = 50
    expect(v[0]).toMatchObject({
      x: 100,
      y: 750,
      w: 50,
      h: 50,
      category: 'cut_short',
      layerName: 'MET1',
    })
    expect(v[1]).toMatchObject({
      x: 0,
      y: 995,
      w: 10,
      h: 5,
      category: 'metal_short',
      layerName: 'MET2',
    })
  })

  it('returns empty array for invalid input', () => {
    expect(parseDrcStepJson(null, 1000)).toEqual([])
    expect(parseDrcStepJson({}, 1000)).toEqual([])
    expect(parseDrcStepJson({ drc: {} }, 1000)).toEqual([])
  })

  it('returns empty when worldHeight invalid', () => {
    expect(parseDrcStepJson({ drc: { distribution: {} } }, 0)).toEqual([])
    expect(parseDrcStepJson({ drc: { distribution: {} } }, -1)).toEqual([])
  })

  it('violationToFitRect expands tiny boxes', () => {
    const r = violationToFitRect(
      { x: 100, y: 200, w: 2, h: 3, category: 'x', layerName: 'M1' },
      100,
    )
    expect(r.w).toBe(100)
    expect(r.h).toBe(100)
    expect(r.x + r.w / 2).toBe(101)
    expect(r.y + r.h / 2).toBe(201.5)
  })
})
