import { waitForDesktopApi } from '@/platform/desktop'

export interface WaitForRuntimeReadyOptions {
  timeoutMs?: number
  pollIntervalMs?: number
}

export async function waitForRuntimeReady(
  options?: WaitForRuntimeReadyOptions,
): Promise<void> {
  await waitForDesktopApi({
    pollIntervalMs: options?.pollIntervalMs,
    timeoutMs: options?.timeoutMs,
  })
}

export const alovaInstance = {
  Get: unsupportedHttpApi,
  Post: unsupportedHttpApi,
}

function unsupportedHttpApi(): never {
  throw new Error('Workspace and flow APIs require the ECOS desktop runtime.')
}
