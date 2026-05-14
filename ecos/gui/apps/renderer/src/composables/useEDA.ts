import { readProjectBlobUrl, resolveProjectFilePath } from '@/utils/projectFiles'

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
   * 通过桌面桥接读取文件并创建 blob URL，避免 renderer 直接依赖桌面运行时 SDK
   */
  const getResourceUrl = async (path: string, projectPath: string): Promise<string> => {
    try {
      const fullPath = resolveProjectFilePath(path, projectPath)

      console.log('Reading file from:', fullPath)
      const blobUrl = await readProjectBlobUrl(fullPath, { mimeType: 'image/png' })

      console.log('Created blob URL:', blobUrl)
      return blobUrl
    } catch (error) {
      console.error('Failed to create blob URL:', error)
      throw error
    }
  }

  return {
    getResourceUrl
  }
}
