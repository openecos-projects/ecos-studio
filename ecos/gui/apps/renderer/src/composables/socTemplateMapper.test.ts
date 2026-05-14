import { describe, expect, it } from 'vitest'
import { normalizeSocTemplateDetail, toSocTemplateSummary } from './socTemplateMapper'

const raw = {
  design_name: 'ysyxSoCASIC',
  dbu: 1000,
  die: { llx: 0, lly: 0, urx: 100, ury: 100, width: 100, height: 100, area: 10000 },
  core: { llx: 10, lly: 10, urx: 90, ury: 90, width: 80, height: 80, area: 6400 },
  io_pins: { number: 58, list: [] },
  cores: {
    number: 2,
    list: [
      { core_id: 4, name: 'core4', info: '', io_align: 'left', orient: 'FN', bounding_box: { llx: 10, lly: 10, urx: 30, ury: 30, width: 20, height: 20, area: 400 } },
      { core_id: 5, name: 'core5', info: 'ok', io_align: 'right', orient: 'N', bounding_box: { llx: 50, lly: 50, urx: 70, ury: 70, width: 20, height: 20, area: 400 } },
    ],
  },
}

describe('socTemplateMapper', () => {
  it('normalizes detail data and fills missing info with a fallback', () => {
    const detail = normalizeSocTemplateDetail(raw, 'Fixed JSON')
    expect(detail.info).toBe('No info provided')
    expect(detail.dbu).toBe(1000)
    expect(detail.ioPinsCount).toBe(58)
    expect(detail.ioPins).toEqual([])
    expect(detail.coreCount).toBe(2)
    expect(detail.cores[0]).toMatchObject({ id: 4, align: 'left', orient: 'FN', info: 'No info provided' })
  })

  it('projects a gallery summary from the normalized detail', () => {
    const detail = normalizeSocTemplateDetail(raw, 'Fixed JSON')
    expect(toSocTemplateSummary(detail)).toMatchObject({
      id: 'ysyxSoCASIC',
      name: 'ysyxSoCASIC',
      ioPinsCount: 58,
      coreCount: 2,
      sourceLabel: 'Fixed JSON',
    })
  })

  it('normalizes rectangle fields into numeric shapes with safe fallbacks', () => {
    const detail = normalizeSocTemplateDetail(
      {
        design_name: 'drifted-template',
        dbu: '2000',
        die: { llx: '1', lly: undefined, urx: '50.5', ury: null, width: '100', height: 'bad', area: '2500' },
        core: { llx: '10', lly: '20', urx: {}, ury: 40, width: '30', height: undefined },
        io_pins: { number: '7' },
        cores: {
          number: 1,
          list: [
            {
              core_id: '3',
              name: 'coreA',
              info: 'ok',
              io_align: 'left',
              orient: 'N',
              bounding_box: { llx: '5', lly: '6', urx: '15', ury: '16', width: '10', height: null, area: '100' },
            },
          ],
        },
      },
      'Fixed JSON',
    )

    expect(detail.dbu).toBe(2000)
    expect(detail.die).toEqual({ llx: 1, lly: 0, urx: 50.5, ury: 0, width: 100, height: 0, area: 2500 })
    expect(detail.coreArea).toEqual({ llx: 10, lly: 20, urx: 0, ury: 40, width: 30, height: 0, area: 0 })
    expect(detail.cores[0]?.boundingBox).toEqual({ llx: 5, lly: 6, urx: 15, ury: 16, width: 10, height: 0, area: 100 })
  })
})
