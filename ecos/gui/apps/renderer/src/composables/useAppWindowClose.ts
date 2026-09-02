import { onMounted, onUnmounted } from 'vue'
import { getDesktopApi } from '@/platform/desktop'

export function useAppWindowClose(cleanup: () => Promise<void>) {
  let isHandlingClose = false
  let unsubscribe: (() => void) | undefined

  onMounted(() => {
    const desktopApi = getDesktopApi()
    unsubscribe = desktopApi.window.onCloseRequested(async () => {
      if (isHandlingClose) return
      isHandlingClose = true

      try {
        await cleanup()
      } catch (error) {
        console.error('Failed to clean up workspace before window close:', error)
      } finally {
        try {
          await desktopApi.window.confirmClose()
        } finally {
          isHandlingClose = false
        }
      }
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })
}
