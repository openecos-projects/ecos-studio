import { describe, expect, it } from 'vitest'
import { validateMpcSpec } from './mpcSpec'

describe('validateMpcSpec', () => {
  it('returns usable designs and their validated pin metadata', () => {
    expect(
      validateMpcSpec({
        number: 1,
        designs: [
          {
            design_name: 'frame',
            io_pins: { number: 1, list: [{ name: 'clock' }] },
            core_template: { name: 'frame' },
          },
        ],
      }).designs,
    ).toMatchObject([
      {
        index: 0,
        declaredPinCount: 1,
        pins: [{ name: 'clock' }],
        coreTemplate: { name: 'frame' },
      },
    ])
  })

  it('rejects documents the renderer cannot display', () => {
    expect(() => validateMpcSpec({})).toThrow('must contain a designs array')
    expect(() => validateMpcSpec({ designs: [{ core_template: [] }] })).toThrow(
      'no design with a core_template object',
    )
    expect(() =>
      validateMpcSpec({
        designs: [
          {
            io_pins: { number: 2, list: [{ name: 'clock' }] },
            core_template: {},
          },
        ],
      }),
    ).toThrow('io_pins.number must match io_pins.list.length')
  })
})
