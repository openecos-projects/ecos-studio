export type RemoteContentSourceId = 'socTemplateCatalog'

export interface RemoteContentListFilesRequest {
  source: RemoteContentSourceId
  pattern?: string
  maxFiles?: number
}

export interface RemoteContentFile {
  source: RemoteContentSourceId
  path: string
  name: string
  size?: number
  sha?: string
}

export interface RemoteContentReadTextFileRequest {
  source: RemoteContentSourceId
  path: string
}

export interface RemoteContentReadJsonFileRequest {
  source: RemoteContentSourceId
  path: string
}

export interface RemoteContentApi {
  listFiles(request: RemoteContentListFilesRequest): Promise<RemoteContentFile[]>
  readTextFile(request: RemoteContentReadTextFileRequest): Promise<string>
  readJsonFile<T = unknown>(request: RemoteContentReadJsonFileRequest): Promise<T>
}
