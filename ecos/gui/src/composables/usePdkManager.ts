import { ref } from 'vue'
import { LazyStore } from '@tauri-apps/plugin-store'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import type { ImportedPdk } from '../types'

// 共享单例 store（与 useWorkspace 共用同一个 settings.json）
const store = new LazyStore('settings.json')

// 全局共享状态
const importedPdks = ref<ImportedPdk[]>([])
const isLoaded = ref(false)

/**
 * PDK 管理 composable
 * 提供 PDK 的导入、持久化、扫描和删除功能
 */
export function usePdkManager() {

  // ============ 持久化读写 ============

  /** 从 LazyStore 加载已导入的 PDK 列表 */
  const loadPdks = async () => {
    if (isLoaded.value) return // 避免重复加载
    try {
      const saved = await store.get<ImportedPdk[]>('imported_pdks')
      if (saved && saved.length > 0) {
        importedPdks.value = saved
      }
      isLoaded.value = true
    } catch (error) {
      console.error('[usePdkManager] Load PDKs error:', error)
    }
  }

  /** 将当前 PDK 列表持久化到磁盘 */
  const savePdks = async () => {
    try {
      await store.set('imported_pdks', importedPdks.value)
      await store.save()
    } catch (error) {
      console.error('[usePdkManager] Save PDKs error:', error)
    }
  }

  // ============ 目录扫描 ============

  /**
   * 扫描 PDK 目录，尝试自动检测 PDK 类型和基本信息
   * 读取顶层目录结构，根据已知模式识别 PDK
   */
  const scanPdkDirectory = async (path: string): Promise<Partial<ImportedPdk>> => {
    const info: Partial<ImportedPdk> = {}

    try {
      // 请求 Rust 端授予访问权限
      try {
        await invoke('request_project_permission', { path })
      } catch {
        // 权限请求失败不阻止继续
      }

      const entries = await readDir(path)
      const topDirs = entries
        .filter(e => e.isDirectory)
        .map(e => e.name)
      const topFiles = entries
        .filter(e => e.isFile)
        .map(e => e.name)

      // 保存目录结构摘要
      info.detectedFiles = {
        directories: topDirs.slice(0, 20),
        files: topFiles.slice(0, 20)
      }

      // ---- 自动检测已知 PDK ----

      // ICS55: 有 prtech/ 和 IP/ 目录
      if (topDirs.includes('prtech') && topDirs.includes('IP')) {
        info.name = 'ics55'
        info.description = 'ICSPROUT 55nm process library (auto-detected)'
        info.techNode = '55nm'
        info.pdkId = 'ics55'
        return info
      }

      // SKY130: 有 sky130_fd_sc_hd 等目录
      if (topDirs.some(d => d.startsWith('sky130'))) {
        info.name = 'SkyWater SKY130 PDK'
        info.description = 'SkyWater 130nm open-source PDK (auto-detected)'
        info.techNode = '130nm'
        info.pdkId = 'sky130'
        return info
      }

      // 通用检测：检查是否包含常见 PDK 文件
      const hasLef = topFiles.some(f => f.endsWith('.lef'))
      const hasLib = topFiles.some(f => f.endsWith('.lib'))
      if (hasLef || hasLib) {
        info.description = 'Process library files detected'
      }

      // 使用目录名作为默认名称
      const dirName = path.split('/').pop() || path.split('\\').pop() || 'Unknown'
      info.name = dirName
      info.pdkId = dirName.toLowerCase().replace(/[^a-z0-9]/g, '_')

    } catch (error) {
      console.error('[usePdkManager] Scan PDK directory error:', error)
    }

    return info
  }

  // ============ PDK 操作 ============

  /**
   * 导入 PDK：弹出目录选择对话框，扫描并保存
   * @returns 导入的 PDK 对象，取消或失败返回 null
   */
  const importPdk = async (): Promise<ImportedPdk | null> => {
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: 'Select PDK Root Directory'
      })

      if (!result) return null

      const path = result as string

      // 检查是否已导入（路径去重）
      const normalizedPath = path.replace(/\\/g, '/').replace(/\/$/, '')
      const existing = importedPdks.value.find(
        p => p.path.replace(/\\/g, '/').replace(/\/$/, '') === normalizedPath
      )
      if (existing) {
        console.warn('[usePdkManager] PDK already imported:', path)
        return existing
      }

      // 扫描目录
      const detected = await scanPdkDirectory(path)

      const pdk: ImportedPdk = {
        id: Date.now().toString(),
        name: detected.name || path.split('/').pop() || 'Unknown PDK',
        path,
        description: detected.description || '',
        techNode: detected.techNode || '',
        pdkId: detected.pdkId || 'custom',
        importedAt: new Date().toISOString(),
        detectedFiles: detected.detectedFiles
      }

      importedPdks.value.push(pdk)
      await savePdks()

      return pdk
    } catch (error) {
      console.error('[usePdkManager] Import PDK error:', error)
      return null
    }
  }

  /**
   * 通过路径直接导入 PDK（不弹对话框）
   * 用于从已知路径导入，比如拖放
   */
  const importPdkByPath = async (path: string): Promise<ImportedPdk | null> => {
    try {
      const normalizedPath = path.replace(/\\/g, '/').replace(/\/$/, '')
      const existing = importedPdks.value.find(
        p => p.path.replace(/\\/g, '/').replace(/\/$/, '') === normalizedPath
      )
      if (existing) return existing

      const detected = await scanPdkDirectory(path)

      const pdk: ImportedPdk = {
        id: Date.now().toString(),
        name: detected.name || path.split('/').pop() || 'Unknown PDK',
        path,
        description: detected.description || '',
        techNode: detected.techNode || '',
        pdkId: detected.pdkId || 'custom',
        importedAt: new Date().toISOString(),
        detectedFiles: detected.detectedFiles
      }

      importedPdks.value.push(pdk)
      await savePdks()

      return pdk
    } catch (error) {
      console.error('[usePdkManager] Import PDK by path error:', error)
      return null
    }
  }

  /** 删除已导入的 PDK */
  const removePdk = async (id: string) => {
    importedPdks.value = importedPdks.value.filter(p => p.id !== id)
    await savePdks()
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
