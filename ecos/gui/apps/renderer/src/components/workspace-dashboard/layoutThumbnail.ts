import type { HomeLayoutThumbnail } from '@/composables/useHomeSnapshots'
import { sameFlowStepName } from '@/api/type'

/** Steps whose layout opens the manual macro-placement entry point. */
export function isMacroPlacementLayoutStep(step: string): boolean {
  return (
    sameFlowStepName(step, 'pre_floorplan') || sameFlowStepName(step, 'macro_placement')
  )
}

/** True when a flow card can open this thumbnail in Chip Viewer. */
export function isUsableLayoutThumbnail(
  thumbnail: HomeLayoutThumbnail | null | undefined,
): thumbnail is HomeLayoutThumbnail & { url: string } {
  return Boolean(
    thumbnail?.url && thumbnail.availability === 'available' && thumbnail.hasGeometry,
  )
}

/**
 * MacroPlacement has no output before it runs. Use the successful
 * preFloorplan layout as the editable source for manual placement until a
 * MacroPlacement thumbnail exists.
 */
export function macroPlacementSourceThumbnail(
  step: string,
  thumbnails: readonly HomeLayoutThumbnail[],
): HomeLayoutThumbnail | null {
  if (!sameFlowStepName(step, 'macro_placement')) return null
  return (
    thumbnails.find((thumbnail) => sameFlowStepName(thumbnail.step, 'pre_floorplan')) ??
    null
  )
}
