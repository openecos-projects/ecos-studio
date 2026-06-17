import type {
  RemoteContentFile,
  RemoteContentListFilesRequest,
  RemoteContentReadJsonFileRequest,
  RemoteContentReadTextFileRequest,
} from '@ecos-studio/shared'
import { waitForDesktopApi } from '@/platform/desktop'

export async function listRemoteContentFiles(
  request: RemoteContentListFilesRequest,
): Promise<RemoteContentFile[]> {
  const api = await waitForDesktopApi()
  return await api.remoteContent.listFiles(request)
}

export async function readRemoteTextFile(
  request: RemoteContentReadTextFileRequest,
): Promise<string> {
  const api = await waitForDesktopApi()
  return await api.remoteContent.readTextFile(request)
}

export async function readRemoteJsonFile<T = unknown>(
  request: RemoteContentReadJsonFileRequest,
): Promise<T> {
  const api = await waitForDesktopApi()
  return await api.remoteContent.readJsonFile<T>(request)
}
