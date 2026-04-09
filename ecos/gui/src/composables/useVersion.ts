import { ref, readonly } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface VersionInfo {
  gui: string
  server: string
  ecc: string
  dreamplace: string
}

const versions = ref<VersionInfo | null>(null)
const loading = ref(false)

async function loadVersions(): Promise<void> {
  if (versions.value || loading.value) return
  loading.value = true
  try {
    versions.value = await invoke<VersionInfo>('get_versions')
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
