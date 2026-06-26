import {
  isAbsoluteLocalPath,
  joinLocalPath,
  type DesktopProjectLogTailEvent,
  type DesktopProjectLogTailSubscriptionOptions,
  type DesktopProjectTextFileTail,
  type DesktopProjectTextFileUpdate,
  type DesktopEventUnsubscribe,
  type DesktopProjectFileChangedEvent,
} from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

export interface ProjectFilePathOptions {
  projectPath?: string
}

export interface ProjectBlobUrlOptions extends ProjectFilePathOptions {
  mimeType?: string
}

export function resolveProjectFilePath(path: string, projectPath?: string): string {
  if (!path || !projectPath || isAbsoluteLocalPath(path)) {
    return path
  }

  return joinLocalPath(projectPath, path)
}

export function getMimeTypeFromPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()

  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'json':
      return 'application/json'
    case 'csv':
      return 'text/csv'
    case 'txt':
    case 'log':
      return 'text/plain'
    default:
      return 'application/octet-stream'
  }
}

function isGzipFilePath(path: string): boolean {
  return path.toLowerCase().endsWith('.gz')
}

async function gunzipToText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('gzip'))
  const buffer = await new Response(stream).arrayBuffer()
  return new TextDecoder().decode(buffer)
}

export async function readProjectTextFile(
  path: string,
  options: ProjectFilePathOptions = {},
): Promise<string> {
  const resolvedPath = resolveProjectFilePath(path, options.projectPath)
  if (isGzipFilePath(resolvedPath)) {
    const bytes = await getDesktopApi().workspace.readProjectBinaryFile(resolvedPath)
    return await gunzipToText(bytes)
  }

  return await getDesktopApi().workspace.readProjectTextFile(resolvedPath)
}

export async function readOptionalProjectTextFile(
  path: string,
  options: ProjectFilePathOptions = {},
): Promise<string | null> {
  const resolvedPath = resolveProjectFilePath(path, options.projectPath)
  const workspace = getDesktopApi().workspace
  const readOptional = workspace.readOptionalProjectTextFile
  if (typeof readOptional === 'function') {
    return await readOptional.call(workspace, resolvedPath)
  }

  try {
    return await workspace.readProjectTextFile(resolvedPath)
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'message' in error
      && typeof error.message === 'string'
      && error.message.includes('ENOENT')
    ) {
      return null
    }

    throw error
  }
}

export async function readProjectTextFileTail(
  path: string,
  maxChars: number,
  options: ProjectFilePathOptions = {},
): Promise<string | null> {
  const resolvedPath = resolveProjectFilePath(path, options.projectPath)
  const workspace = getDesktopApi().workspace
  const readTail = workspace.readProjectTextFileTail
  if (typeof readTail === 'function') {
    return await readTail.call(workspace, resolvedPath, maxChars)
  }

  const fullContent = await readOptionalProjectTextFile(resolvedPath)
  return fullContent === null ? null : fullContent.slice(-maxChars)
}

export async function readOptionalProjectTextFileTail(
  path: string,
  maxChars: number,
  options: ProjectFilePathOptions = {},
): Promise<DesktopProjectTextFileTail | null> {
  const resolvedPath = resolveProjectFilePath(path, options.projectPath)
  const workspace = getDesktopApi().workspace
  const readTail = workspace.readOptionalProjectTextFileTail
  if (typeof readTail === 'function') {
    return await readTail.call(workspace, resolvedPath, maxChars)
  }

  const fullContent = await readOptionalProjectTextFile(resolvedPath)
  if (fullContent === null) return null

  return {
    content: fullContent.slice(-maxChars),
    truncated: fullContent.length > maxChars,
    sizeBytes: new TextEncoder().encode(fullContent).byteLength,
  }
}

export async function readOptionalProjectTextFileUpdate(
  path: string,
  fromOffsetBytes: number,
  maxChars: number,
  options: ProjectFilePathOptions = {},
): Promise<DesktopProjectTextFileUpdate | null> {
  const resolvedPath = resolveProjectFilePath(path, options.projectPath)
  const workspace = getDesktopApi().workspace
  const readUpdate = workspace.readOptionalProjectTextFileUpdate
  if (typeof readUpdate === 'function') {
    return await readUpdate.call(workspace, resolvedPath, fromOffsetBytes, maxChars)
  }

  const fullContent = await readOptionalProjectTextFile(resolvedPath)
  if (fullContent === null) return null

  const bytes = new TextEncoder().encode(fullContent)
  const normalizedOffset = Math.max(0, Math.floor(fromOffsetBytes))
  const reset = normalizedOffset > bytes.byteLength
  const content = reset
    ? fullContent.slice(-maxChars)
    : fullContent.slice(normalizedOffset).slice(-maxChars)

  return {
    content,
    fromOffsetBytes: reset ? 0 : normalizedOffset,
    nextOffsetBytes: bytes.byteLength,
    sizeBytes: bytes.byteLength,
    reset,
    truncated: reset || content.length >= maxChars,
  }
}

export async function readProjectJsonFile<T>(
  path: string,
  options: ProjectFilePathOptions = {},
): Promise<T> {
  return JSON.parse(await readProjectTextFile(path, options)) as T
}

export async function readProjectBinaryFile(
  path: string,
  options: ProjectFilePathOptions = {},
): Promise<Uint8Array> {
  const resolvedPath = resolveProjectFilePath(path, options.projectPath)
  return await getDesktopApi().workspace.readProjectBinaryFile(resolvedPath)
}

export async function writeProjectTextFile(
  path: string,
  content: string,
  options: ProjectFilePathOptions = {},
): Promise<void> {
  const resolvedPath = resolveProjectFilePath(path, options.projectPath)
  await getDesktopApi().workspace.writeProjectTextFile(resolvedPath, content)
}

export async function watchProjectFile(
  path: string,
  listener: (event: DesktopProjectFileChangedEvent) => void,
  options: ProjectFilePathOptions = {},
): Promise<DesktopEventUnsubscribe | null> {
  const resolvedPath = resolveProjectFilePath(path, options.projectPath)
  const workspace = getDesktopApi().workspace
  const watchFn = workspace.watchProjectFile
  if (typeof watchFn !== 'function') return null
  return await watchFn.call(workspace, resolvedPath, listener)
}

export async function subscribeProjectLogTail(
  path: string,
  listener: (event: DesktopProjectLogTailEvent) => void,
  options: DesktopProjectLogTailSubscriptionOptions = {},
  projectOptions: ProjectFilePathOptions = {},
): Promise<DesktopEventUnsubscribe | null> {
  const resolvedPath = resolveProjectFilePath(path, projectOptions.projectPath)
  const workspace = getDesktopApi().workspace
  const subscribeFn = workspace.subscribeProjectLogTail
  if (typeof subscribeFn !== 'function') return null
  return await subscribeFn.call(workspace, resolvedPath, options, listener)
}

export async function readProjectBlobUrl(
  path: string,
  options: ProjectBlobUrlOptions = {},
): Promise<string> {
  const resolvedPath = resolveProjectFilePath(path, options.projectPath)
  const bytes = await readProjectBinaryFile(resolvedPath)
  const blobBytes = Uint8Array.from(bytes)
  const blob = new Blob([blobBytes], {
    type: options.mimeType ?? getMimeTypeFromPath(resolvedPath),
  })
  return URL.createObjectURL(blob)
}
