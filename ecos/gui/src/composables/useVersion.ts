import { ref, readonly } from 'vue'
import { fetchVersions, type VersionInfo } from '@/api/client'

const versions = ref<VersionInfo | null>(null)
const loading = ref(false)

async function loadVersions(): Promise<void> {
  if (versions.value || loading.value) return
  loading.value = true
  try {
    versions.value = await fetchVersions()
  } catch (err) {
    console.warn('[version] failed to fetch versions:', err)
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
