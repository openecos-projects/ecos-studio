import { describe, expect, it } from 'vitest'

import { isHdlFilePath } from './hdlPath'

describe('isHdlFilePath', () => {
  it.each([
    ['src/top.v'],
    ['src/top.sv'],
    ['src/top.vhd'],
    ['src/top.vhdl'],
    ['src/Nested/ALU.SV'],
    ['C:\\projects\\chip\\rtl\\core.V'],
    ['/rtl/top.v.gz'],
    ['/rtl/core.sv.gz'],
    ['/rtl/pkg.vhd.gz'],
    ['/rtl/pkg.vhdl.gz'],
  ])('accepts HDL source path %s', (path) => {
    expect(isHdlFilePath(path)).toBe(true)
  })

  it.each([
    ['src/top.v.bak'],
    ['src/README.md'],
    ['src/top'],
    ['src/.sv'],
    ['src/sv'],
    ['/rtl/readme.txt.gz'],
    ['/rtl/layout.def.gz'],
  ])('rejects non-HDL path %s', (path) => {
    expect(isHdlFilePath(path)).toBe(false)
  })
})
