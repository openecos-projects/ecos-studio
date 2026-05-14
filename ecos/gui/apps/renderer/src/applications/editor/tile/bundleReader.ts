import {
  LocalPathOutsideRootError,
  resolveContainedLocalPath,
} from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

export function joinBundleLocalPath(localRoot: string, relativePath: string): string {
  return resolveContainedLocalPath(localRoot, relativePath)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function isFileNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /ENOENT|not found|No such file|os error 2/i.test(message)
}

export class BundleFileNotFoundError extends Error {
  constructor(relativePath: string) {
    super(`${relativePath} not found`)
    this.name = 'BundleFileNotFoundError'
  }
}

export class BundlePathOutsideRootError extends Error {
  constructor(relativePath: string, _cause?: unknown) {
    super(`Refusing bundle path outside bundle root: ${relativePath}`)
    this.name = 'BundlePathOutsideRootError'
  }
}

export interface TileBundleReader {
  readBinary(relativePath: string, signal?: AbortSignal): Promise<ArrayBuffer>
  readBlob(relativePath: string, signal?: AbortSignal): Promise<Blob>
  readText(relativePath: string, signal?: AbortSignal): Promise<string>
}

export interface TileBundleReaderDependencies {
  fetchImpl?: typeof fetch
  readProjectBinaryFile?: (path: string) => Promise<Uint8Array>
  readProjectTextFile?: (path: string) => Promise<string>
}

export interface TileBundleReaderOptions {
  baseUrl: string
  localRoot?: string
}

async function fetchOrThrow(
  fetchImpl: typeof fetch,
  url: string,
  relativePath: string,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetchImpl(url, { signal })
  if (response.status === 404) {
    throw new BundleFileNotFoundError(relativePath)
  }
  if (!response.ok) {
    throw new Error(`bundle fetch failed: ${response.status}`)
  }
  return response
}

export function createTileBundleReader(
  options: TileBundleReaderOptions,
  deps: TileBundleReaderDependencies = {},
): TileBundleReader {
  const fetchImpl = deps.fetchImpl ?? fetch
  const readProjectTextFile = deps.readProjectTextFile
    ?? ((path: string) => getDesktopApi().workspace.readProjectTextFile(path))
  const readProjectBinaryFile = deps.readProjectBinaryFile
    ?? ((path: string) => getDesktopApi().workspace.readProjectBinaryFile(path))

  function resolveBundleUrl(relativePath: string): string {
    return new URL(relativePath, ensureTrailingSlash(options.baseUrl)).toString()
  }

  async function readLocalBinary(relativePath: string): Promise<ArrayBuffer> {
    try {
      const bytes = await readProjectBinaryFile(joinBundleLocalPath(options.localRoot!, relativePath))
      return toArrayBuffer(bytes)
    } catch (error) {
      if (error instanceof LocalPathOutsideRootError) {
        throw new BundlePathOutsideRootError(relativePath, error)
      }
      if (isFileNotFoundError(error)) {
        throw new BundleFileNotFoundError(relativePath)
      }
      throw error
    }
  }

  async function readLocalText(relativePath: string): Promise<string> {
    try {
      return await readProjectTextFile(joinBundleLocalPath(options.localRoot!, relativePath))
    } catch (error) {
      if (error instanceof LocalPathOutsideRootError) {
        throw new BundlePathOutsideRootError(relativePath, error)
      }
      if (isFileNotFoundError(error)) {
        throw new BundleFileNotFoundError(relativePath)
      }
      throw error
    }
  }

  return {
    async readText(relativePath: string, signal?: AbortSignal): Promise<string> {
      if (options.localRoot) {
        return await readLocalText(relativePath)
      }

      const response = await fetchOrThrow(
        fetchImpl,
        resolveBundleUrl(relativePath),
        relativePath,
        signal,
      )
      return await response.text()
    },

    async readBinary(relativePath: string, signal?: AbortSignal): Promise<ArrayBuffer> {
      if (options.localRoot) {
        return await readLocalBinary(relativePath)
      }

      const response = await fetchOrThrow(
        fetchImpl,
        resolveBundleUrl(relativePath),
        relativePath,
        signal,
      )
      return await response.arrayBuffer()
    },

    async readBlob(relativePath: string, signal?: AbortSignal): Promise<Blob> {
      if (options.localRoot) {
        return new Blob([await readLocalBinary(relativePath)])
      }

      const response = await fetchOrThrow(
        fetchImpl,
        resolveBundleUrl(relativePath),
        relativePath,
        signal,
      )
      return await response.blob()
    },
  }
}
