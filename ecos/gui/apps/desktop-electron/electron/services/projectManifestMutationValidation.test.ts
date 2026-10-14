import { describe, expect, it } from 'vitest'
import { validateProjectManifestMutation } from './projectManifestMutationValidation'

describe('validateProjectManifestMutation create rtlImport', () => {
  it('accepts a create mutation without rtlImport', () => {
    expect(() =>
      validateProjectManifestMutation({
        type: 'create',
        name: 'demo',
        designName: 'gcd',
      }),
    ).not.toThrow()
  })

  it('accepts an exclusive filelist selection', () => {
    expect(() =>
      validateProjectManifestMutation({
        type: 'create',
        name: 'demo',
        designName: 'gcd',
        rtlImport: { filelist: '/inputs/files.f', verilog: [] },
      }),
    ).not.toThrow()
  })

  it('accepts an exclusive verilog selection', () => {
    expect(() =>
      validateProjectManifestMutation({
        type: 'create',
        name: 'demo',
        designName: 'gcd',
        rtlImport: { verilog: ['/inputs/a.v', '/inputs/b.v'] },
      }),
    ).not.toThrow()
  })

  it('rejects selecting both a filelist and verilog files', () => {
    expect(() =>
      validateProjectManifestMutation({
        type: 'create',
        name: 'demo',
        designName: 'gcd',
        rtlImport: { filelist: '/inputs/files.f', verilog: ['/inputs/a.v'] },
      }),
    ).toThrow('not both')
  })

  it('rejects an empty selection', () => {
    expect(() =>
      validateProjectManifestMutation({
        type: 'create',
        name: 'demo',
        designName: 'gcd',
        rtlImport: {},
      }),
    ).toThrow('must set filelist or verilog')
  })

  it('rejects verilog entries that are not non-empty strings', () => {
    expect(() =>
      validateProjectManifestMutation({
        type: 'create',
        name: 'demo',
        designName: 'gcd',
        rtlImport: { verilog: ['/inputs/a.v', ' '] },
      }),
    ).toThrow('array of non-empty strings')
  })
})
