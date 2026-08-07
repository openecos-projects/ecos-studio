import { describe, expect, it } from 'vitest'
import {
  formatCpuTopModule,
  isVerilogIdentifier,
  normalizeCpuPortContract,
  YSYX_BLACKBOX_CPU_PORT_CONTRACT,
} from './frontendCpuContract'

describe('frontend CPU contract rendering', () => {
  it('normalizes structured catalog ports and rejects malformed entries', () => {
    expect(
      normalizeCpuPortContract([
        { name: 'clock', direction: 'INPUT', width: 1 },
        { name: 'data_o', direction: 'output', width: 32 },
        { name: 'data_o', direction: 'output', width: 32 },
        { name: 'bad-name', direction: 'input', width: 1 },
        { name: 'bad_width', direction: 'input', width: 0 },
      ]),
    ).toEqual([
      { name: 'clock', direction: 'input', width: 1 },
      { name: 'data_o', direction: 'output', width: 32 },
    ])
  })

  it('formats module declarations from catalog directions and widths', () => {
    expect(
      formatCpuTopModule('cpu_top', [
        { name: 'clock', direction: 'input', width: 1 },
        { name: 'data_o', direction: 'output', width: 32 },
      ]),
    ).toBe(
      [
        'module cpu_top (',
        '  input clock,',
        '  output [31:0] data_o',
        ');',
        '',
        'endmodule',
      ].join('\n'),
    )
  })

  it('validates module names as Verilog identifiers', () => {
    expect(isVerilogIdentifier('ysyx_00000000')).toBe(true)
    expect(isVerilogIdentifier('cpu_top$impl')).toBe(true)
    expect(isVerilogIdentifier('00000000_cpu')).toBe(false)
    expect(isVerilogIdentifier('cpu-top')).toBe(false)
    expect(isVerilogIdentifier('module')).toBe(false)
    expect(isVerilogIdentifier('always_ff')).toBe(false)
    expect(isVerilogIdentifier('')).toBe(false)
  })

  it('matches the 61-port YSYX BlackBox CPU interface', () => {
    expect(YSYX_BLACKBOX_CPU_PORT_CONTRACT).toHaveLength(61)
    expect(YSYX_BLACKBOX_CPU_PORT_CONTRACT.slice(0, 4)).toEqual([
      { name: 'clock', direction: 'input', width: 1 },
      { name: 'reset', direction: 'input', width: 1 },
      { name: 'io_interrupt', direction: 'input', width: 1 },
      { name: 'io_master_awready', direction: 'input', width: 1 },
    ])
    expect(
      YSYX_BLACKBOX_CPU_PORT_CONTRACT[YSYX_BLACKBOX_CPU_PORT_CONTRACT.length - 1],
    ).toEqual({
      name: 'io_slave_rlast',
      direction: 'output',
      width: 1,
    })
  })
})
