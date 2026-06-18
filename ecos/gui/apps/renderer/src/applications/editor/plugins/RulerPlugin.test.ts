import { describe, expect, it } from 'vitest'
import { __rulerPluginInternals } from './RulerPlugin'

describe('RulerPlugin viewport transform guards', () => {
  it('rejects invalid viewport transforms before redrawing rulers', () => {
    expect(__rulerPluginInternals.isValidRulerViewportTransform({ x: Number.NaN, y: 0, scale: 1 })).toBe(false)
    expect(__rulerPluginInternals.isValidRulerViewportTransform({ x: 0, y: Number.POSITIVE_INFINITY, scale: 1 })).toBe(false)
    expect(__rulerPluginInternals.isValidRulerViewportTransform({ x: 0, y: 0, scale: 0 })).toBe(false)
    expect(__rulerPluginInternals.isValidRulerViewportTransform({ x: 0, y: 0, scale: Number.NaN })).toBe(false)
  })

  it('accepts finite viewport transforms with a positive scale', () => {
    expect(__rulerPluginInternals.isValidRulerViewportTransform({ x: -120, y: 45, scale: 0.001 })).toBe(true)
  })
})
