import type { DesktopApi } from '@ecos-studio/shared'

export const DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE = 'ECOS desktop bridge is not available.'

declare global {
  interface Window {
    ecosDesktop?: DesktopApi
  }
}

function getGlobalWindow(): (Window & typeof globalThis) | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window
}

export function hasDesktopApi(): boolean {
  return getGlobalWindow()?.ecosDesktop != null
}

export function getOptionalDesktopApi(): DesktopApi | null {
  return getGlobalWindow()?.ecosDesktop ?? null
}

export function getDesktopApi(): DesktopApi {
  const desktopApi = getOptionalDesktopApi()

  if (!desktopApi) {
    throw new Error(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE)
  }

  return desktopApi
}

export async function waitForDesktopApi(options?: {
  timeoutMs?: number
  pollIntervalMs?: number
}): Promise<DesktopApi> {
  const timeoutMs = options?.timeoutMs ?? 3000
  const pollIntervalMs = options?.pollIntervalMs ?? 50
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    const desktopApi = getOptionalDesktopApi()
    if (desktopApi) {
      return desktopApi
    }

    await new Promise((resolve) => {
      setTimeout(resolve, pollIntervalMs)
    })
  }

  throw new Error(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE)
}
