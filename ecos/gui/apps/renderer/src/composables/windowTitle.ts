import { getDesktopApi } from '@/platform/desktop'

export async function setDesktopWindowTitle(title: string): Promise<void> {
  await getDesktopApi().window.setTitle(title)
}
