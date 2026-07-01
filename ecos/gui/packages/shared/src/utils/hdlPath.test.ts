import { describe, expect, it } from 'vitest'

import { isHdlFilePath } from './hdlPath.ts'

describe('isHdlFilePath', () => {
  it.each([
    ['src/top.v'],
    ['src/top.sv'],
    ['src/top.vhd'],
    ['src/top.vhdl'],
    ['src/Nested/ALU.SV'],
    ['C:\\projects\\chip\\rtl\\core.V'],
  ])('accepts HDL source path %s', (path) => {
    expect(isHdlFilePath(path)).toBe(true)
  })

  it.each([['src/top.v.bak'], ['src/README.md'], ['src/top'], ['src/.sv'], ['src/sv']])(
    'rejects non-HDL path %s',
    (path) => {
      expect(isHdlFilePath(path)).toBe(false)
    },
  )
})
