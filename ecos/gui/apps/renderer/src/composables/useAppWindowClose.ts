import { onMounted, onUnmounted } from 'vue'
import { getDesktopApi } from '@/platform/desktop'

export function useAppWindowClose(cleanup: () => Promise<void>) {
  let isHandlingClose = false
  let unsubscribe: (() => void) | undefined

  onMounted(() => {
    const desktopApi = getDesktopApi()
    const shutdown = desktopApi.shutdown
    if (!shutdown) return
    unsubscribe = shutdown.onCleanupRequested(async ({ attemptId }) => {
      if (isHandlingClose) return
      isHandlingClose = true
      try {
        await cleanup()
        await shutdown.completeCleanup({ attemptId, ok: true })
      } catch (error) {
        console.error('Failed to clean up workspace before window close:', error)
        await shutdown.completeCleanup({
          attemptId,
          issue: error instanceof Error ? error.message : String(error),
          ok: false,
        })
      } finally {
        isHandlingClose = false
      }
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })
}
