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
  it.each(['pre_floorplan', 'macro_placement', 'Macro Placement'])(
    'opens macro-placement choices from %s',
    (step) => {
      expect(isMacroPlacementLayoutStep(step)).toBe(true)
    },
  )

  it.each(['post_floorplan', 'placement', 'routing'])(
    'keeps %s read-only from the flow diagram',
    (step) => {
      expect(isMacroPlacementLayoutStep(step)).toBe(false)
    },
  )

  it('requires an available layout with geometry before opening Chip Viewer', () => {
    expect(isUsableLayoutThumbnail(thumbnail('pre_floorplan'))).toBe(true)
    expect(isUsableLayoutThumbnail(null)).toBe(false)
    expect(isUsableLayoutThumbnail(thumbnail('pre_floorplan', { url: null }))).toBe(false)
    expect(
      isUsableLayoutThumbnail(thumbnail('pre_floorplan', { hasGeometry: false })),
    ).toBe(false)
    expect(
      isUsableLayoutThumbnail(thumbnail('pre_floorplan', { availability: 'stale' })),
    ).toBe(false)
  })

  it('uses preFloorplan geometry as the macro-placement source', () => {
    const preFloorplan = thumbnail('pre_floorplan')
    const macroPlacement = thumbnail('macro_placement')

    expect(
      macroPlacementSourceThumbnail('macro_placement', [preFloorplan, macroPlacement]),
    ).toBe(preFloorplan)
    expect(macroPlacementSourceThumbnail('pre_floorplan', [preFloorplan])).toBeNull()
    expect(macroPlacementSourceThumbnail('macro_placement', [])).toBeNull()
  })
})
