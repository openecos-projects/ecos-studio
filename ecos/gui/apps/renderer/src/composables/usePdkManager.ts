import { ref } from 'vue'
import type { PdkInstallationSnapshot } from '@ecos-studio/shared'
import { waitForDesktopApi } from '@/platform/desktop'
import { useWorkspace } from './useWorkspace'
import type { ImportedPdk } from '../types'

const importedPdks = ref<ImportedPdk[]>([])
const isLoaded = ref(false)
const pdkNameDialogVisible = ref(false)
const pdkNameDraft = ref('')
let resolvePdkName: ((name: string | null) => void) | null = null
const pdkImportCancelled = new Error('PDK import was cancelled')

function requestPdkName(suggestedName: string): Promise<string | null> {
  resolvePdkName?.(null)
  pdkNameDraft.value = suggestedName
  pdkNameDialogVisible.value = true
  return new Promise((resolve) => {
    resolvePdkName = resolve
  })
}

function finishPdkNameRequest(name: string | null): void {
  const resolve = resolvePdkName
  resolvePdkName = null
  pdkNameDialogVisible.value = false
  resolve?.(name)
}

function confirmPdkName(): void {
  const name = pdkNameDraft.value.trim()
  if (name) finishPdkNameRequest(name)
}

function cancelPdkName(): void {
  finishPdkNameRequest(null)
}

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

async function importPath(path: string): Promise<ImportedPdk> {
  const desktopApi = await waitForDesktopApi()
  const scanned = await desktopApi.workspace.scanPdkDirectory(path)
  let familyId = scanned.pdkId
  let displayName = scanned.name || familyId
  if (familyId !== 'ics55') {
    const confirmed = await requestPdkName(displayName)
    if (confirmed === null) throw pdkImportCancelled
    displayName = confirmed
    familyId =
      confirmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || familyId
  }
  const installation = await desktopApi.pdkInventory.import({
    root: path,
    familyId,
    displayName,
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
      const linked = importedPdks.value.find((pdk) => pdk.id === imported.id) ?? imported
      showToast({
        severity: 'success',
        summary: 'PDK Linked',
        detail: `${linked.name} is ready at ${linked.path}. Files remain in the source directory.`,
      })
      return linked
    } catch (error) {
      if (error === pdkImportCancelled) return null
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
      if (error === pdkImportCancelled) return null
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
    removePdk,
    locatePdk,
    validatePdk,
    pdkNameDialogVisible,
    pdkNameDraft,
    confirmPdkName,
    cancelPdkName,
    getPdkById: (id: string) => importedPdks.value.find((pdk) => pdk.id === id),
  }
}
