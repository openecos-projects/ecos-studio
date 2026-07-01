export function convertRemoteToLocalPath(
  remotePath: string,
  projectPath: string,
): string {
  if (!remotePath || !remotePath.includes('/nfs/')) return remotePath
  if (!projectPath) return remotePath

  const projectName = projectPath.split(/[/\\]/).filter(Boolean).pop()
  if (!projectName) return remotePath

  const projectNameIndex = remotePath.indexOf(`/${projectName}/`)
  if (projectNameIndex === -1) return remotePath

  const relativePath = remotePath.slice(projectNameIndex + projectName.length + 2)
  const separator = projectPath.includes('\\') ? '\\' : '/'
  const normalizedProjectPath = projectPath.replace(/[/\\]+$/, '')
  const normalizedRelativePath =
    separator === '\\' ? relativePath.replace(/\//g, '\\') : relativePath

  return `${normalizedProjectPath}${separator}${normalizedRelativePath}`
}
