import { ref } from 'vue'
import type { DesktopApi, ResourceInfo } from '@ecos-studio/shared'
import {
  importLocalResourcePathApi,
  importPdkPathApi,
  listResourcesApi,
  removePdkReferenceApi,
} from '@/api/plugin'
import { hasDesktopApi, waitForDesktopApi } from '@/platform/desktop'
import { useWorkspace } from './useWorkspace'
import type { ImportedPdk } from '../types'

const LEGACY_IMPORTED_PDKS_KEY = 'imported_pdks'
const LEGACY_MIGRATION_KEY = 'pdk_inventory_migrated_v1'

const importedPdks = ref<ImportedPdk[]>([])
const isLoaded = ref(false)

function healthValue(resource: ResourceInfo, key: string): unknown {
  return resource.health[key]
}

function resourceToPdk(resource: ResourceInfo): ImportedPdk {
  const detectedFiles = healthValue(resource, 'detected_file_groups')
  return {
    id: resource.id,
    name: resource.display_name,
    path: resource.path ?? '',
    description: resource.description,
    techNode: resource.name === 'ics55' ? '55nm' : '',
    pdkId: resource.name,
    importedAt: String(healthValue(resource, 'imported_at') ?? ''),
    detectedFiles:
      detectedFiles && typeof detectedFiles === 'object'
        ? (detectedFiles as ImportedPdk['detectedFiles'])
        : undefined,
    source: resource.source,
    version: resource.installed_version ?? '',
    active: resource.active,
    status: resource.status,
    valid: resource.status === 'installed' || resource.status === 'update_available',
    knownLayout: healthValue(resource, 'known_layout') === true,
  }
}

function legacyPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const path = (entry as { path?: unknown }).path
    return typeof path === 'string' && path.trim() ? [path] : []
  })
}

async function migrateLegacyPdks(desktopApi: DesktopApi): Promise<void> {
  const migrated = await desktopApi.settings.get(LEGACY_MIGRATION_KEY)
  if (migrated === true) return

  const legacy = await desktopApi.settings.get(LEGACY_IMPORTED_PDKS_KEY)
  for (const path of legacyPaths(legacy)) {
    try {
      await importPdkPathApi(path)
    } catch {
      // Keep legacy settings untouched; missing and invalid paths are represented only when imported.
    }
  }
  await desktopApi.settings.set(LEGACY_MIGRATION_KEY, true)
}

export function usePdkManager() {
  const { showToast } = useWorkspace()

  const loadPdks = async (force = false): Promise<void> => {
    if (isLoaded.value && !force) return
    try {
      if (hasDesktopApi()) {
        const desktopApi = await waitForDesktopApi()
        await migrateLegacyPdks(desktopApi)
      }
      const resources = await listResourcesApi()
      importedPdks.value = resources
        .filter(
          (resource) =>
            resource.type === 'pdk' &&
            resource.path !== null &&
            resource.status !== 'installing',
        )
        .map(resourceToPdk)
        .sort(
          (left, right) =>
            Number(right.active) - Number(left.active) ||
            left.name.localeCompare(right.name),
        )
      isLoaded.value = true
    } catch (error) {
      console.error('[usePdkManager] Failed to load Resource Manager PDKs:', error)
    }
  }

  const importPdk = async (): Promise<ImportedPdk | null> => {
    try {
      const desktopApi = await waitForDesktopApi()
      const path = await desktopApi.dialog.pickDirectory({
        title: 'Select PDK Root Directory',
      })
      if (!path) return null
      const resource = await importPdkPathApi(path)
      await loadPdks(true)
      return (
        importedPdks.value.find((pdk) => pdk.id === resource.id) ??
        resourceToPdk(resource)
      )
    } catch (error) {
      showToast({
        severity: 'error',
        summary: 'Failed to Import PDK',
        detail:
          error instanceof Error
            ? error.message
            : 'The selected PDK directory could not be imported.',
      })
      return null
    }
  }

  const importPdkByPath = async (path: string): Promise<ImportedPdk | null> => {
    try {
      const resource = await importPdkPathApi(path)
      await loadPdks(true)
      return (
        importedPdks.value.find((pdk) => pdk.id === resource.id) ??
        resourceToPdk(resource)
      )
    } catch (error) {
      showToast({
        severity: 'error',
        summary: 'Failed to Import PDK',
        detail:
          error instanceof Error
            ? error.message
            : 'The selected PDK directory could not be imported.',
      })
      return null
    }
  }

  const importPdkForResource = async (
    resourceId: string,
    path: string,
  ): Promise<ImportedPdk> => {
    const resource = await importLocalResourcePathApi(resourceId, path)
    await loadPdks(true)
    return (
      importedPdks.value.find((pdk) => pdk.id === resource.id) ?? resourceToPdk(resource)
    )
  }

  const removePdk = async (resourceId: string): Promise<void> => {
    await removePdkReferenceApi(resourceId)
    await loadPdks(true)
  }

  return {
    importedPdks,
    loadPdks,
    importPdk,
    importPdkByPath,
    importPdkForResource,
    removePdk,
    getPdkById: (id: string) => importedPdks.value.find((pdk) => pdk.id === id),
  }
}
