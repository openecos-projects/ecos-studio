import { describe, expect, it } from 'vitest'
import { formatCpuTopModule, normalizeCpuPortContract } from './frontendCpuContract'

describe('frontend CPU contract rendering', () => {
  it('normalizes structured catalog ports and rejects malformed entries', () => {
    expect(normalizeCpuPortContract([
      { name: 'clock', direction: 'INPUT', width: 1 },
      { name: 'data_o', direction: 'output', width: 32 },
      { name: 'data_o', direction: 'output', width: 32 },
      { name: 'bad-name', direction: 'input', width: 1 },
      { name: 'bad_width', direction: 'input', width: 0 },
    ])).toEqual([
      { name: 'clock', direction: 'input', width: 1 },
      { name: 'data_o', direction: 'output', width: 32 },
    ])
  })

  it('formats module declarations from catalog directions and widths', () => {
    expect(formatCpuTopModule('cpu_top', [
      { name: 'clock', direction: 'input', width: 1 },
      { name: 'data_o', direction: 'output', width: 32 },
    ])).toBe([
      'module cpu_top (',
      '  input clock,',
      '  output [31:0] data_o',
      ');',
      '',
      'endmodule',
    ].join('\n'))
  })
})
