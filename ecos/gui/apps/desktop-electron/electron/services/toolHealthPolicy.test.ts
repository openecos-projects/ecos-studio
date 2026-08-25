import { describe, expect, it } from 'vitest'
import { requiredToolHealthMarkers } from './toolHealthPolicy'

describe('tool health policy', () => {
  it('declares each marker once with an explicit validation kind', () => {
    for (const name of [
      'verilator',
      'riscv-toolchain',
      'ecc-fe',
      'ecc-fe-soc-ysyx-am',
      'ecc-fe-cpu-rtl',
      'ecc-fe-cpu-custom',
      'ecc-fe-difftest-ref',
      'ecc-fe-examples',
      'ecc-fe-test-smoke',
      'surfer',
    ]) {
      const markers = requiredToolHealthMarkers(name)
      expect(markers.length).toBeGreaterThan(0)
      expect(markers.every((marker) => marker.path && marker.kind)).toBe(true)
      expect(new Set(markers.map((marker) => marker.path)).size).toBe(markers.length)
    }
  })

  it('assigns the expected filesystem type to each marker', () => {
    expect(requiredToolHealthMarkers('verilator')).toEqual([
      { path: 'bin/verilator', kind: 'executable' },
      { path: 'bin/verilator_bin', kind: 'executable' },
      { path: 'share/verilator/include/verilated.cpp', kind: 'file' },
    ])
    expect(requiredToolHealthMarkers('ecc-fe')).toEqual([
      { path: 'bin/ecc-fe', kind: 'executable' },
      { path: 'fecompiler', kind: 'directory' },
    ])
    expect(requiredToolHealthMarkers('ecc-fe-cpu-custom')).toEqual([
      { path: 'thirdparty', kind: 'directory' },
    ])
    expect(requiredToolHealthMarkers('ecc-fe-difftest-ref')).toEqual([
      { path: 'tools/riscv32-spike-so', kind: 'file' },
    ])
    expect(requiredToolHealthMarkers('ecc-fe-test-smoke')).toEqual([
      { path: 'tests', kind: 'directory' },
    ])
  })

  it('returns no required markers for unknown tools', () => {
    expect(requiredToolHealthMarkers('unknown-tool')).toEqual([])
  })
})
