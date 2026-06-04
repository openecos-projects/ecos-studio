import { ref, toRaw } from 'vue'
import type { DesktopApi, DesktopSettingsValue, ScannedPdkDirectory } from '@ecos-studio/shared'
import { importPdkPathApi, removePdkReferenceApi } from '@/api/plugin'
import { hasDesktopApi, waitForDesktopApi } from '@/platform/desktop'
import { useWorkspace } from './useWorkspace'
import type { ImportedPdk } from '../types'

/** 路径中是否包含中文或空格（不允许，会导致工具链异常） */
function pathHasInvalidChars(path: string): boolean {
  const hasSpace = /\s/.test(path)
  const hasChinese = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(path)
  return hasSpace || hasChinese
}

// 全局共享状态
const importedPdks = ref<ImportedPdk[]>([])
const isLoaded = ref(false)
const IMPORTED_PDKS_STORAGE_KEY = 'ecos.imported_pdks'

function isMissingBackendReference(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const maybe = error as {
    status?: number
    statusCode?: number
    response?: { status?: number }
    message?: string
  }
  const status = maybe.status ?? maybe.statusCode ?? maybe.response?.status
  if (status === 404) return true

  const message = maybe.message?.toLowerCase() ?? ''
  return message.includes('404') || message.includes('not found')
}

function toSerializableImportedPdk(pdk: ImportedPdk): ImportedPdk {
  return {
    id: pdk.id,
    name: pdk.name,
    path: pdk.path,
    description: pdk.description,
    techNode: pdk.techNode,
    pdkId: pdk.pdkId,
    importedAt: pdk.importedAt,
    detectedFiles: pdk.detectedFiles
      ? {
          directories: [...pdk.detectedFiles.directories],
          files: [...pdk.detectedFiles.files],
        }
      : undefined,
  }
}

function serializeImportedPdks(pdks: ImportedPdk[]): ImportedPdk[] {
  const serializable = toRaw(pdks).map((pdk) => toSerializableImportedPdk(pdk))
  return JSON.parse(JSON.stringify(serializable)) as ImportedPdk[]
}

function buildImportedPdk(detected: ScannedPdkDirectory): ImportedPdk {
  return {
    id: Date.now().toString(),
    name: detected.name,
    path: detected.canonicalPath,
    description: detected.description,
    techNode: detected.techNode,
    pdkId: detected.pdkId,
    importedAt: new Date().toISOString(),
    detectedFiles: detected.detectedFiles,
  }
}

function normalizePdkPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '')
}

function dedupeImportedPdks(pdks: ImportedPdk[]): ImportedPdk[] {
  const deduped = new Map<string, ImportedPdk>()
  for (const pdk of pdks) {
    deduped.set(normalizePdkPath(pdk.path), pdk)
  }
  return Array.from(deduped.values())
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

function getLocalStorage(): Storage | null {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
    return null
  }

  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function loadPdksFromLocalStorage(): ImportedPdk[] | null {
  const storage = getLocalStorage()

  if (!storage) {
    return null
  }

  const raw = storage.getItem(IMPORTED_PDKS_STORAGE_KEY)
  if (!raw) {
    return null
  }

  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    return null
  }

  return parsed as ImportedPdk[]
}

function savePdksToLocalStorage(pdks: ImportedPdk[]): void {
  const storage = getLocalStorage()

  if (!storage) {
    throw new Error('localStorage is not available.')
  }

  storage.setItem(IMPORTED_PDKS_STORAGE_KEY, JSON.stringify(pdks))
}

async function getSetting<T>(desktopApi: DesktopApi, key: string): Promise<T | null> {
  return (await desktopApi.settings.get(key)) as T | null
}

async function setSetting(
  desktopApi: DesktopApi,
  key: string,
  value: unknown,
): Promise<void> {
  await desktopApi.settings.set(key, value as DesktopSettingsValue)
}

/**
 * PDK 管理 composable
 * 提供 PDK 的导入、持久化、扫描和删除功能
 */
export function usePdkManager() {
  const { showToast } = useWorkspace()

  // ============ 持久化读写 ============

  /** 从 LazyStore 加载已导入的 PDK 列表 */
  const loadPdks = async () => {
    if (isLoaded.value) return // 避免重复加载
    try {
      let saved: ImportedPdk[] | null = null
      let desktopApi: DesktopApi | undefined

      if (hasDesktopApi()) {
        try {
          desktopApi = await waitForDesktopApi()
          saved = await getSetting<ImportedPdk[]>(desktopApi, 'imported_pdks')
        } catch (error) {
          console.warn('[usePdkManager] Desktop settings unavailable during load, falling back to localStorage:', error)
        }
      }

      if (!saved || saved.length === 0) {
        saved = loadPdksFromLocalStorage()
      }

      if (saved && saved.length > 0) {
        const deduped = dedupeImportedPdks(saved)
        importedPdks.value = deduped

        await Promise.all(
          deduped.map(async (pdk) => {
            try {
              await syncImportedPdkReference(pdk.path)
            } catch (error) {
              console.warn('[usePdkManager] Failed to sync imported PDK to backend manifest:', pdk.path, error)
            }
          }),
        )

        if (desktopApi && deduped.length !== saved.length) {
          await savePdks(desktopApi)
        }
      }
      isLoaded.value = true
    } catch (error) {
      console.error('[usePdkManager] Load PDKs error:', error)
    }
  }

  /** 将当前 PDK 列表持久化到磁盘 */
  const savePdks = async (desktopApi?: DesktopApi) => {
    const serialized = serializeImportedPdks(importedPdks.value)
    let desktopError: unknown = null

    if (desktopApi) {
      try {
        await setSetting(desktopApi, 'imported_pdks', serialized)
      } catch (error) {
        desktopError = error
        console.warn('[usePdkManager] Desktop settings unavailable during save, falling back to localStorage:', error)
      }
    }

    try {
      savePdksToLocalStorage(serialized)
    } catch (storageError) {
      console.error('[usePdkManager] Save PDKs fallback error:', storageError)
      throw desktopError ?? storageError
    }
  }

  // ============ 目录扫描 ============

  /**
   * 扫描 PDK 目录，尝试自动检测 PDK 类型和基本信息
   * 读取顶层目录结构，根据已知模式识别 PDK
   */
  const scanPdkDirectory = async (
    desktopApi: DesktopApi,
    path: string,
  ): Promise<ScannedPdkDirectory> => {
    return await desktopApi.workspace.scanPdkDirectory(path)
  }

  const syncImportedPdkReference = async (path: string): Promise<void> => {
    await importPdkPathApi(path)
  }

  // ============ PDK 操作 ============

  /**
   * 导入 PDK：弹出目录选择对话框，扫描并保存
   * @returns 导入的 PDK 对象，取消或失败返回 null
   */
  const importPdk = async (): Promise<ImportedPdk | null> => {
    try {
      const desktopApi = await waitForDesktopApi()
      const result = await desktopApi.dialog.pickDirectory({
        title: 'Select PDK Root Directory'
      })

      if (!result) return null

      const path = result

      // 路径不允许包含中文或空格，避免工具链异常
      if (pathHasInvalidChars(path)) {
        showToast({ severity: 'error', summary: 'Invalid PDK Path', detail: 'PDK path cannot contain Chinese or spaces, please select a directory containing only English, numbers and common symbols.' })
        return null
      }

      let detected: ScannedPdkDirectory
      try {
        detected = await scanPdkDirectory(desktopApi, path)
      } catch (error) {
        console.error('[usePdkManager] Scan PDK error:', error)
        showToast({
          severity: 'error',
          summary: 'Failed to Import PDK',
          detail: 'The selected PDK directory could not be scanned.',
        })
        return null
      }

      const normalizedPath = normalizePdkPath(detected.canonicalPath)
      const existing = importedPdks.value.find(
        p => normalizePdkPath(p.path) === normalizedPath
      )
      if (existing) {
        await syncImportedPdkReference(detected.canonicalPath)
        console.warn('[usePdkManager] PDK already imported:', detected.canonicalPath)
        return existing
      }

      await syncImportedPdkReference(detected.canonicalPath)
      const pdk = buildImportedPdk(detected)

      importedPdks.value.push(pdk)
      await savePdks(desktopApi)

      return pdk
    } catch (error) {
      console.error('[usePdkManager] Import PDK error:', error)
      showToast({
        severity: 'error',
        summary: 'Failed to Import PDK',
        detail: `The selected PDK directory was detected, but saving it locally failed. ${getErrorMessage(error)}`,
      })
      return null
    }
  }

  /**
   * 通过路径直接导入 PDK（不弹对话框）
   * 用于从已知路径导入，比如拖放
   */
  const importPdkByPath = async (path: string): Promise<ImportedPdk | null> => {
    try {
      const desktopApi = await waitForDesktopApi()

      if (pathHasInvalidChars(path)) {
        console.warn('[usePdkManager] 无效的 PDK 路径：路径不能包含中文或空格，请选择仅含英文、数字及常见符号的目录。path:', path)
        return null
      }

      let detected: ScannedPdkDirectory
      try {
        detected = await scanPdkDirectory(desktopApi, path)
      } catch (error) {
        console.error('[usePdkManager] Scan PDK by path error:', error)
        showToast({
          severity: 'error',
          summary: 'Failed to Import PDK',
          detail: 'The selected PDK directory could not be scanned.',
        })
        return null
      }

      const normalizedPath = normalizePdkPath(detected.canonicalPath)
      const existing = importedPdks.value.find(
        p => normalizePdkPath(p.path) === normalizedPath
      )
      if (existing) {
        await syncImportedPdkReference(detected.canonicalPath)
        return existing
      }

      await syncImportedPdkReference(detected.canonicalPath)
      const pdk = buildImportedPdk(detected)

      importedPdks.value.push(pdk)
      await savePdks(desktopApi)

      return pdk
    } catch (error) {
      console.error('[usePdkManager] Import PDK by path error:', error)
      showToast({
        severity: 'error',
        summary: 'Failed to Import PDK',
        detail: `The selected PDK directory was detected, but saving it locally failed. ${getErrorMessage(error)}`,
      })
      return null
    }
  }

  /** 删除已导入的 PDK */
  const removePdk = async (id: string) => {
    const desktopApi = hasDesktopApi() ? await waitForDesktopApi() : undefined
    const pdk = importedPdks.value.find(p => p.id === id)
    if (pdk) {
      try {
        await removePdkReferenceApi(`pdk:${pdk.pdkId}`)
      } catch (error) {
        if (!isMissingBackendReference(error)) {
          throw error
        }
      }
    }
    importedPdks.value = importedPdks.value.filter(p => p.id !== id)
    await savePdks(desktopApi)
  }

  /** 根据 ID 查找 PDK */
  const getPdkById = (id: string): ImportedPdk | undefined => {
    return importedPdks.value.find(p => p.id === id)
  }

  return {
    importedPdks,
    loadPdks,
    importPdk,
    importPdkByPath,
    removePdk,
    getPdkById,
  }
}
