import type { HomeLayoutThumbnail } from '@/composables/useHomeSnapshots'
import { sameFlowStepName } from '@/api/type'

/** Steps whose layout opens the manual macro-placement entry point. */
export function isMacroPlacementLayoutStep(step: string): boolean {
  return (
    sameFlowStepName(step, 'preFloorplan') || sameFlowStepName(step, 'macroPlacement')
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
  if (!sameFlowStepName(step, 'macroPlacement')) return null
  return (
    thumbnails.find((thumbnail) => sameFlowStepName(thumbnail.step, 'preFloorplan')) ??
    null
  )
}
