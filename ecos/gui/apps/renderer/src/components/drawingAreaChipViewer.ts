import type { ChipViewerOpenRequest } from '@ecos-studio/shared'

export type ChipViewerMode = NonNullable<ChipViewerOpenRequest['mode']>

export const CHIP_VIEWER_LOADING_MESSAGE = 'Opening saved Chip Viewer layout...'
export const CHIP_VIEWER_EDIT_LOADING_MESSAGE = 'Opening editable saved layout...'

export interface ChipViewerAvailability {
  isDesktopRuntime: boolean
  projectPath: string | null | undefined
  step: string | null | undefined
}

export interface ChipViewerLaunchState extends ChipViewerAvailability {
  chipViewerBusy: boolean
  chipViewerEditBusy: boolean
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

export function shouldShowChipViewer(state: ChipViewerAvailability): boolean {
  return state.isDesktopRuntime && hasText(state.projectPath) && hasText(state.step)
}

export function canOpenChipViewer(state: ChipViewerLaunchState): boolean {
  return shouldShowChipViewer(state) && !state.chipViewerBusy && !state.chipViewerEditBusy
}

export function buildChipViewerOpenRequest(
  projectPath: string,
  step: string,
  mode: ChipViewerMode,
): ChipViewerOpenRequest {
  return {
    mode,
    projectPath,
    step,
  }
}

export function chipViewerLoadingMessage(mode: ChipViewerMode): string {
  return mode === 'edit' ? CHIP_VIEWER_EDIT_LOADING_MESSAGE : CHIP_VIEWER_LOADING_MESSAGE
}
