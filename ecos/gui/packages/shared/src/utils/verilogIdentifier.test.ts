import { describe, expect, it } from 'vitest'
import { isVerilogIdentifier } from './verilogIdentifier.ts'

describe('isVerilogIdentifier', () => {
  it('accepts Verilog identifiers including dollar signs', () => {
    expect(isVerilogIdentifier('gcd_top')).toBe(true)
    expect(isVerilogIdentifier(' _ok ')).toBe(true)
    expect(isVerilogIdentifier('Foo$bar')).toBe(true)
  })

  it('rejects empty values, paths, and dotted names', () => {
    expect(isVerilogIdentifier('')).toBe(false)
    expect(isVerilogIdentifier('   ')).toBe(false)
    expect(isVerilogIdentifier('gcd top')).toBe(false)
    expect(isVerilogIdentifier('/rtl/top.v')).toBe(false)
    expect(isVerilogIdentifier('pkg.top')).toBe(false)
    expect(isVerilogIdentifier('1top')).toBe(false)
  })
})
