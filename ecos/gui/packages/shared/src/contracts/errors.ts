export type DesktopErrorCode =
  | 'APP_BACKEND_UNAVAILABLE'
  | 'INVALID_PROJECT_DIRECTORY'
  | 'PROJECT_SCOPE_DENIED'
  | 'SETTINGS_WRITE_FAILED'
  | 'TILE_GENERATION_FAILED'

export interface DesktopErrorShape {
  code: DesktopErrorCode
  message: string
  detail?: string
}
