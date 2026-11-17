import { describe, expect, it } from 'vitest'
import type { HomeLayoutThumbnail } from '@/composables/useHomeSnapshots'
import {
  isMacroPlacementLayoutStep,
  isUsableLayoutThumbnail,
  macroPlacementSourceThumbnail,
} from './layoutThumbnail'

function thumbnail(
  step: string,
  overrides: Partial<HomeLayoutThumbnail> = {},
): HomeLayoutThumbnail {
  return {
    id: `${step}-layout`,
    kind: 'layout',
    label: `${step} Layout`,
    step,
    url: `blob:${step}`,
    hasGeometry: true,
    availability: 'available',
    reason: null,
    ...overrides,
  }
}

describe('layout thumbnail actions', () => {
  it.each(['preFloorplan', 'macroPlacement', 'Macro Placement'])(
    'opens macro-placement choices from %s',
    (step) => {
      expect(isMacroPlacementLayoutStep(step)).toBe(true)
    },
  )

  it.each(['postFloorplan', 'place', 'route'])(
    'keeps %s read-only from the flow diagram',
    (step) => {
      expect(isMacroPlacementLayoutStep(step)).toBe(false)
    },
  )

  it('requires an available layout with geometry before opening Chip Viewer', () => {
    expect(isUsableLayoutThumbnail(thumbnail('preFloorplan'))).toBe(true)
    expect(isUsableLayoutThumbnail(null)).toBe(false)
    expect(isUsableLayoutThumbnail(thumbnail('preFloorplan', { url: null }))).toBe(false)
    expect(
      isUsableLayoutThumbnail(thumbnail('preFloorplan', { hasGeometry: false })),
    ).toBe(false)
    expect(
      isUsableLayoutThumbnail(thumbnail('preFloorplan', { availability: 'stale' })),
    ).toBe(false)
  })

  it('uses preFloorplan geometry as the macro-placement source', () => {
    const preFloorplan = thumbnail('preFloorplan')
    const macroPlacement = thumbnail('macroPlacement')

    expect(
      macroPlacementSourceThumbnail('macroPlacement', [preFloorplan, macroPlacement]),
    ).toBe(preFloorplan)
    expect(macroPlacementSourceThumbnail('preFloorplan', [preFloorplan])).toBeNull()
    expect(macroPlacementSourceThumbnail('macroPlacement', [])).toBeNull()
  })
})
