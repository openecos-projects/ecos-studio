import { hasDesktopApi, waitForDesktopApi } from '@/platform/desktop'

export async function setDesktopWindowTitle(title: string): Promise<void> {
  if (!hasDesktopApi()) {
    return
  }

  const desktopApi = await waitForDesktopApi()
  await desktopApi.window.setTitle(title)
}
