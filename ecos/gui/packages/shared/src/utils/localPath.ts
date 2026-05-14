export function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path)
}

export function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || isWindowsDrivePath(path)
}

export function normalizeLocalPath(path: string): string {
  if (!path) {
    return path
  }

  const isUnc = path.startsWith('\\\\')
  const drivePrefix = path.match(/^[A-Za-z]:/)?.[0] ?? ''
  const hasDrivePrefix = drivePrefix.length > 0
  const normalizedSource = path.replace(/[\\/]+/g, '/')
  let remainder = normalizedSource
  let separator = '/'

  if (isUnc) {
    remainder = normalizedSource.replace(/^\/+/, '')
    separator = '\\'
  } else if (hasDrivePrefix) {
    remainder = normalizedSource.slice(drivePrefix.length).replace(/^\/+/, '')
    separator = '\\'
  } else if (normalizedSource.startsWith('/')) {
    remainder = normalizedSource.replace(/^\/+/, '')
  }

  const parts: string[] = []
  for (const part of remainder.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      const last = parts[parts.length - 1]
      if (last && last !== '..') {
        parts.pop()
      } else if (!isUnc && !hasDrivePrefix && !normalizedSource.startsWith('/')) {
        parts.push(part)
      }
      continue
    }
    parts.push(part)
  }

  if (isUnc) {
    return `\\\\${parts.join('\\')}`
  }
  if (hasDrivePrefix) {
    return parts.length > 0 ? `${drivePrefix}\\${parts.join('\\')}` : `${drivePrefix}\\`
  }
  if (normalizedSource.startsWith('/')) {
    return parts.length > 0 ? `/${parts.join('/')}` : '/'
  }
  return parts.join(separator)
}

export function joinLocalPath(basePath: string, relativePath: string): string {
  const separator = isWindowsDrivePath(basePath) || basePath.includes('\\') ? '\\' : '/'
  return normalizeLocalPath(
    `${basePath.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/^[\\/]+/, '')}`,
  )
}

export function resolveProjectFileAbsolutePath(projectPath: string, inputPath: string): string {
  const trimmed = inputPath.trim()
  if (!trimmed) {
    throw new Error('布局 JSON 路径为空')
  }

  if (isAbsoluteLocalPath(trimmed)) {
    return normalizeLocalPath(trimmed)
  }

  if (trimmed.startsWith('home/') || trimmed.startsWith('Users/')) {
    return normalizeLocalPath(`/${trimmed}`)
  }

  return joinLocalPath(projectPath, trimmed)
}

export class LocalPathOutsideRootError extends Error {
  constructor(rootPath: string, requestedPath: string) {
    super(`Refusing local path outside root ${rootPath}: ${requestedPath}`)
    this.name = 'LocalPathOutsideRootError'
  }
}

export function resolveContainedLocalPath(rootPath: string, relativePath: string): string {
  const trimmed = relativePath.trim()
  if (!trimmed) {
    throw new LocalPathOutsideRootError(rootPath, relativePath)
  }

  if (isAbsoluteLocalPath(trimmed)) {
    throw new LocalPathOutsideRootError(rootPath, relativePath)
  }

  const normalizedRootPath = normalizeLocalPath(rootPath).replace(/[\\/]+$/, '')
  const separator = isWindowsDrivePath(normalizedRootPath) || normalizedRootPath.includes('\\')
    ? '\\'
    : '/'
  const resolvedPath = joinLocalPath(normalizedRootPath, trimmed)
  const rootPrefix = `${normalizedRootPath}${separator}`

  if (resolvedPath !== normalizedRootPath && !resolvedPath.startsWith(rootPrefix)) {
    throw new LocalPathOutsideRootError(normalizedRootPath, relativePath)
  }

  return resolvedPath
}
