import { ref, readonly } from 'vue'
import type { VersionInfo } from '@ecos-studio/shared'
import { getOptionalDesktopApi, waitForDesktopApi } from '@/platform/desktop'

const versions = ref<VersionInfo | null>(null)
const loading = ref(false)

async function loadVersions(): Promise<void> {
  if (versions.value || loading.value) return
  loading.value = true
  try {
    const desktopApi =
      getOptionalDesktopApi() ?? await waitForDesktopApi({ timeoutMs: 5000 })
    versions.value = await desktopApi.app.getVersions()
  } catch (err) {
    console.warn('[version] failed to get versions:', err)
  } finally {
    loading.value = false
  }
}

export function useVersion() {
  return {
    versions: readonly(versions),
    loading: readonly(loading),
    loadVersions,
  }
}
