import { onMounted, onUnmounted } from 'vue'
import { waitForDesktopApi } from '@/platform/desktop'

export function useAppWindowClose(cleanup: () => Promise<boolean | void>) {
  let isHandlingClose = false
  let unsubscribe: (() => void) | undefined

  onMounted(() => {
    void waitForDesktopApi({ timeoutMs: 5000 })
      .then((desktopApi) => {
        unsubscribe = desktopApi.window.onCloseRequested(async () => {
          if (isHandlingClose) {
            return
          }

          isHandlingClose = true
          let shouldConfirmClose = true

          try {
            const shouldClose = await cleanup()
            shouldConfirmClose = shouldClose !== false
          } catch (error) {
            console.error('Failed to clean up workspace before window close:', error)
          } finally {
            if (!shouldConfirmClose) {
              isHandlingClose = false
              return
            }
            try {
              await desktopApi.window.confirmClose()
            } finally {
              isHandlingClose = false
            }
          }
        })
      })
      .catch((error) => {
        console.warn('[useAppWindowClose] Desktop bridge not available on mount:', error)
      })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })
}
