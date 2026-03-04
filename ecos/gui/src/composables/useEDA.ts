import { convertFileSrc } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'

export interface PyResult {
  code: number
  stdout: string
  stderr: string
}

export interface EdaResponse<T = any> {
  status: 'success' | 'error'
  payload?: T
  message?: string
  traceback?: string
}

export function useEDA() {

  /**
   * 将本地资源路径转换为可在 PIXI 中使用的 URL
   * 使用 fs plugin 读取文件并创建 blob URL，绕过 asset protocol 限制
   */
  const getResourceUrl = async (path: string, projectPath: string): Promise<string> => {
    try {
      // 构建完整路径
      let fullPath = path
      if (!path.startsWith('/') && !/^[a-zA-Z]:/.test(path)) {
        const separator = projectPath.endsWith('/') || projectPath.endsWith('\\') ? '' : '/'
        fullPath = `${projectPath}${separator}${path}`
      }

      console.log('Reading file from:', fullPath)

      // 使用 fs plugin 读取文件
      const fileData = await readFile(fullPath)

      // 创建 Blob
      const blob = new Blob([fileData], { type: 'image/png' })

      // 创建 blob URL
      const blobUrl = URL.createObjectURL(blob)

      console.log('Created blob URL:', blobUrl)
      return blobUrl
    } catch (error) {
      console.error('Failed to create blob URL:', error)
      // 如果读取失败，回退到 convertFileSrc
      if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
        return convertFileSrc(path)
      }
      const separator = projectPath.endsWith('/') || projectPath.endsWith('\\') ? '' : '/'
      const fullPath = `${projectPath}${separator}${path}`
      return convertFileSrc(fullPath)
    }
  }

  return {
    getResourceUrl
  }
}
