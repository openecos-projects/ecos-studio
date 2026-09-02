import type { DesktopApi } from '@ecos-studio/shared'

export const DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE = 'ECOS desktop bridge is not available.'

declare global {
  interface Window {
    ecosDesktop: DesktopApi
  }
}

export function getDesktopApi(): DesktopApi {
  const desktopApi = typeof window === 'undefined' ? undefined : window.ecosDesktop

  if (!desktopApi) {
    throw new Error(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE)
  }

  return desktopApi
}
