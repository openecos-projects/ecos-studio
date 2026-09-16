import { describe, expect, it } from 'vitest'
import { frontendSourceLanguageForPath } from './frontendSourceLanguage'

describe('frontendSourceLanguageForPath', () => {
  it.each([
    ['rtl/core.v', 'verilog'],
    ['rtl/defs.VH', 'verilog'],
    ['rtl/core.sv', 'systemverilog'],
    ['rtl/defs.SVH', 'systemverilog'],
    ['src/main.c', 'c'],
    ['include/model.h', 'c'],
    ['src/model.CPP', 'cpp'],
    ['include/model.hpp', 'cpp'],
    ['scripts/check.py', 'python'],
    ['scripts/run.sh', 'shell'],
    ['scripts/setup.tcl', 'tcl'],
    ['firmware/start.S', 'ecos-disassembly'],
    ['firmware/trap.asm', 'ecos-disassembly'],
  ])('maps %s to %s', (path, language) => {
    expect(frontendSourceLanguageForPath(path)).toBe(language)
  })

  it('uses plaintext for file lists and unknown paths', () => {
    expect(frontendSourceLanguageForPath('rtl/files.f')).toBe('plaintext')
    expect(frontendSourceLanguageForPath('README')).toBe('plaintext')
  })

  it('ignores URL query and fragment suffixes', () => {
    expect(frontendSourceLanguageForPath('rtl/core.sv?revision=2#L10')).toBe(
      'systemverilog',
    )
  })
})
