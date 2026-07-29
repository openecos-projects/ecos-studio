import { describe, expect, it } from 'vitest'
import {
  findDisassemblyAddressLine,
  normalizeDisassemblyAddress,
  stripSourceFromDisassembly,
} from './disassembly'

describe('disassembly address navigation', () => {
  it('normalizes hexadecimal PCs', () => {
    expect(normalizeDisassemblyAddress('0x80000010')).toBe('80000010')
    expect(normalizeDisassemblyAddress('0000000080000010')).toBe('80000010')
    expect(normalizeDisassemblyAddress('not-an-address')).toBe('')
  })

  it('finds instruction lines without matching operands or symbol headers', () => {
    const content = [
      '80000000 <_start>:',
      '    80000000:\t00000013\tnop',
      '    80000004:\t01050513\taddi a0,a0,16',
      '    80000010:\t00008067\tret',
    ].join('\n')

    expect(findDisassemblyAddressLine(content, '0x80000010')).toBe(4)
    expect(findDisassemblyAddressLine(content, '0x10')).toBeNull()
    expect(findDisassemblyAddressLine(content, '')).toBeNull()
  })
})

describe('disassembly source filtering', () => {
  it('keeps native objdump -d output unchanged', () => {
    const content = [
      'demo.elf:     file format elf32-littleriscv',
      '',
      'Disassembly of section .text:',
      '',
      '20000020 <main>:',
      '20000020:\tfe010113\taddi sp,sp,-32',
    ].join('\n')

    expect(stripSourceFromDisassembly(content)).toBe(content)
  })

  it('removes source locations and C statements from legacy objdump -S output', () => {
    const content = [
      'demo.elf:     file format elf32-littleriscv',
      '',
      'Disassembly of section .text:',
      '',
      '20000020 <main>:',
      'main():',
      '/workspace/tests/add.c:13',
      'int main() {',
      '20000020:\tfe010113\taddi sp,sp,-32',
      '/workspace/tests/add.c:14 (discriminator 2)',
      '  int i = 0;',
      '20000024:\t01212823\tsw s2,16(sp)',
      '}',
    ].join('\n')

    expect(stripSourceFromDisassembly(content)).toBe(
      [
        'demo.elf:     file format elf32-littleriscv',
        '',
        'Disassembly of section .text:',
        '',
        '20000020 <main>:',
        '20000020:\tfe010113\taddi sp,sp,-32',
        '20000024:\t01212823\tsw s2,16(sp)',
        '',
      ].join('\n'),
    )
  })
})
