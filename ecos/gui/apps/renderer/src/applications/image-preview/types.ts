export interface ViewportTransform {
  x: number
  y: number
  scale: number
}

import type { ThemeName } from '@/applications/editor/core/Theme'

export interface ImagePreviewOptions {
  theme?: ThemeName
}
