import { ref } from 'vue'
import type { PdkInstallationSnapshot } from '@ecos-studio/shared'
import { waitForDesktopApi } from '@/platform/desktop'
import { useWorkspace } from './useWorkspace'
import type { ImportedPdk } from '../types'

const importedPdks = ref<ImportedPdk[]>([])
const isLoaded = ref(false)

function installationToPdk(installation: PdkInstallationSnapshot): ImportedPdk {
  return {
    id: installation.id,
    name: installation.displayName,
    path: installation.root,
    description: installation.reason ?? '',
    techNode: installation.familyId === 'ics55' ? '55nm' : '',
    pdkId: installation.familyId,
    importedAt: '',
    source: installation.ownership,
    version: installation.version ?? '',
    readiness: installation.readiness,
    supportsEccDefaults: installation.supportsEccDefaults,
  }
}

async function importPath(
  path: string,
  requestedFamilyId?: string,
): Promise<ImportedPdk> {
  const desktopApi = await waitForDesktopApi()
  const scanned = await desktopApi.workspace.scanPdkDirectory(path)
  let familyId = requestedFamilyId || scanned.pdkId
  if (!requestedFamilyId && familyId !== 'ics55' && typeof window !== 'undefined') {
    const confirmed = window.prompt('PDK Family ID', familyId)
    if (confirmed === null) throw new Error('PDK import was cancelled')
    familyId = confirmed.trim()
  }
  const installation = await desktopApi.pdkInventory.import({
    root: path,
    familyId,
    displayName: scanned.name || familyId,
  })
  return installationToPdk(installation)
}

export function usePdkManager() {
  const { showToast } = useWorkspace()

  const loadPdks = async (force = false): Promise<void> => {
    if (isLoaded.value && !force) return
    try {
      const desktopApi = await waitForDesktopApi()
      importedPdks.value = (await desktopApi.pdkInventory.list())
        .map(installationToPdk)
        .sort((left, right) => left.name.localeCompare(right.name))
      isLoaded.value = true
    } catch (error) {
      console.error('[usePdkManager] Failed to load PDK Inventory:', error)
    }
  }

  const importPdk = async (): Promise<ImportedPdk | null> => {
    try {
      const desktopApi = await waitForDesktopApi()
      const path = await desktopApi.dialog.pickDirectory({
        title: 'Select PDK Root Directory',
      })
      if (!path) return null
      const imported = await importPath(path)
      await loadPdks(true)
      return importedPdks.value.find((pdk) => pdk.id === imported.id) ?? imported
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
      const imported = await importPath(path)
      await loadPdks(true)
      return importedPdks.value.find((pdk) => pdk.id === imported.id) ?? imported
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
    const imported = await importPath(path, resourceId.replace(/^pdk:/, ''))
    await loadPdks(true)
    return importedPdks.value.find((pdk) => pdk.id === imported.id) ?? imported
  }

  const removePdk = async (installationId: string): Promise<void> => {
    const desktopApi = await waitForDesktopApi()
    await desktopApi.pdkInventory.remove(installationId)
    await loadPdks(true)
  }

  const locatePdk = async (installationId: string): Promise<void> => {
    const desktopApi = await waitForDesktopApi()
    const path = await desktopApi.dialog.pickDirectory({ title: 'Locate PDK Root' })
    if (!path) return
    await desktopApi.pdkInventory.locate({ installationId, root: path })
    await loadPdks(true)
  }

  const validatePdk = async (_installationId?: string): Promise<void> => {
    await loadPdks(true)
  }

  return {
    importedPdks,
    loadPdks,
    importPdk,
    importPdkByPath,
    importPdkForResource,
    removePdk,
    locatePdk,
    validatePdk,
    getPdkById: (id: string) => importedPdks.value.find((pdk) => pdk.id === id),
  }
}
