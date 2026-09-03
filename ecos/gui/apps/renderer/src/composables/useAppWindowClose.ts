import { onMounted, onUnmounted } from 'vue'
import { getDesktopApi } from '@/platform/desktop'

export function useAppWindowClose(
  cleanup: () => Promise<void>,
  options: { beforeClose?: () => boolean | Promise<boolean> } = {},
) {
  let isHandlingClose = false
  let unsubscribe: (() => void) | undefined

  onMounted(() => {
    const desktopApi = getDesktopApi()
    unsubscribe = desktopApi.window.onCloseRequested(async () => {
      if (isHandlingClose) return
      isHandlingClose = true
      let shouldConfirmClose = true

      try {
        if (options.beforeClose && !(await options.beforeClose())) {
          shouldConfirmClose = false
          return
        }
        await cleanup()
      } catch (error) {
        console.error('Failed to clean up workspace before window close:', error)
      } finally {
        if (shouldConfirmClose) {
          try {
            await desktopApi.window.confirmClose()
          } finally {
            isHandlingClose = false
          }
        } else {
          isHandlingClose = false
        }
      }
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })
}
