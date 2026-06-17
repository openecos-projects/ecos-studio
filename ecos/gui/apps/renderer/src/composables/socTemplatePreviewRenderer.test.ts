import { describe, expect, it } from 'vitest'
import type { SocTemplateDetail } from './socTemplateMapper'
import { buildSocIoPinRects, buildSocPreviewRects, formatSocArea, formatSocBoundingBox } from './socTemplatePreviewRenderer'

const template = {
  id: 'demo',
  name: 'demo',
  info: 'No info provided',
  ioPinsCount: 0,
  coreCount: 1,
  sourceLabel: 'Fixed JSON',
  dbu: 1000,
  die: { llx: 0, lly: 0, urx: 300, ury: 300, width: 300, height: 300 },
  coreArea: { llx: 50, lly: 20, urx: 250, ury: 220, width: 200, height: 200 },
  cores: [
    { id: 1, name: 'u_GEN/u_GEN_1/core1', info: 'No info provided', align: 'left', orient: 'N', selected: 0, boundingBox: { llx: 70, lly: 140, urx: 110, ury: 180, width: 40, height: 40 } },
  ],
  ioPins: [],
} satisfies SocTemplateDetail

describe('socTemplatePreviewRenderer', () => {
  it('projects core boxes into percentage-based preview rects', () => {
    expect(buildSocPreviewRects({
      ...template,
      cores: [
        {
          ...template.cores[0]!,
          name: 'u_GEN/u_GEN_1/core15',
        },
      ],
    })).toEqual([
      expect.objectContaining({
        coreId: 1,
        label: 'core1',
        leftPct: 10,
        topPct: 20,
        widthPct: 20,
        heightPct: 20,
      }),
    ])
  })

  it('returns stable zero percentages when the core area cannot be projected safely', () => {
    expect(buildSocPreviewRects({
      ...template,
      coreArea: { llx: 50, lly: 20, urx: 50, ury: 20, width: 0, height: 0 },
    })).toEqual([
      expect.objectContaining({
        coreId: 1,
        leftPct: 0,
        topPct: 0,
        widthPct: 0,
        heightPct: 0,
      }),
    ])
  })

  it('formats the bounding box line for the inspector', () => {
    expect(formatSocBoundingBox(template.cores[0]!.boundingBox, 10)).toBe('7, 14, 11, 18')
    expect(formatSocArea(40000, 10)).toBe('400')
  })

  it('places IO pads on die coordinates and uses ring fallback when bbox is empty', () => {
    const withIo = {
      ...template,
      ioPinsCount: 3,
      ioPins: [
        {
          name: 'clk_pad',
          info: '',
          boundingBox: { llx: 5, lly: 275, urx: 25, ury: 295, width: 20, height: 20 },
        },
        { name: 'ghost_a', info: '', boundingBox: { llx: 0, lly: 0, urx: 0, ury: 0, width: 0, height: 0 } },
        { name: 'ghost_b', info: '', boundingBox: { llx: 0, lly: 0, urx: 0, ury: 0, width: 0, height: 0 } },
      ],
    } satisfies SocTemplateDetail

    const rects = buildSocIoPinRects(withIo)
    expect(rects.filter((r) => r.placement === 'die')).toHaveLength(1)
    expect(rects.filter((r) => r.placement === 'ring')).toHaveLength(2)
    expect(rects.find((r) => r.name === 'clk_pad')?.placement).toBe('die')
  })
})
