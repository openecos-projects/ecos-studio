import { describe, expect, it } from 'vitest'
import { findDisassemblyAddressLine, normalizeDisassemblyAddress } from './disassembly'

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
