import { describe, expect, it } from 'vitest'
import { __editorInternals } from './Editor'

describe('Editor viewport transform guards', () => {
  it('rejects non-finite or non-positive viewport transforms', () => {
    expect(__editorInternals.isValidViewportTransform({ x: Number.NaN, y: 0, scale: 1 })).toBe(false)
    expect(__editorInternals.isValidViewportTransform({ x: 0, y: Number.NEGATIVE_INFINITY, scale: 1 })).toBe(false)
    expect(__editorInternals.isValidViewportTransform({ x: 0, y: 0, scale: 0 })).toBe(false)
    expect(__editorInternals.isValidViewportTransform({ x: 0, y: 0, scale: Number.POSITIVE_INFINITY })).toBe(false)
  })

  it('accepts finite viewport transforms with a positive scale', () => {
    expect(__editorInternals.isValidViewportTransform({ x: 32, y: -16, scale: 0.06 })).toBe(true)
  })
})
