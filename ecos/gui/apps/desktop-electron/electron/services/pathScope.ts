import { isAbsolute, relative, sep } from 'node:path'

export function isRelativePathOutsideRoot(relativePath: string): boolean {
  return relativePath === '..' || relativePath.startsWith(`..${sep}`)
}

export function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, candidatePath)
  return (
    relativePath === '' ||
    (!isRelativePathOutsideRoot(relativePath) && !isAbsolute(relativePath))
  )
}

export function isSameOrAncestorPath(path: string, descendantPath: string): boolean {
  return isPathWithinRoot(descendantPath, path)
}
