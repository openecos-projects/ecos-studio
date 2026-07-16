export interface RtlTreeNode {
  name: string
  path: string
  kind: 'directory' | 'file'
  children: RtlTreeNode[]
}

export function buildRtlFileTree(rootPath: string, files: string[]): RtlTreeNode {
  const normalizedRoot = normalizePath(rootPath)
  const rootName = normalizedRoot.split('/').filter(Boolean).pop() ?? normalizedRoot
  const root: RtlTreeNode = {
    name: rootName,
    path: normalizedRoot,
    kind: 'directory',
    children: [],
  }

  for (const filePath of files) {
    const normalizedFile = normalizePath(filePath)
    const relativePath = getRelativePath(normalizedRoot, normalizedFile)
    if (!relativePath) {
      continue
    }

    const segments = relativePath.split('/').filter(Boolean)
    let current = root
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!
      const isFile = index === segments.length - 1
      const nodePath = joinPath(normalizedRoot, segments.slice(0, index + 1).join('/'))
      let child = current.children.find((entry) => entry.name === segment)
      if (!child) {
        child = {
          name: segment,
          path: nodePath,
          kind: isFile ? 'file' : 'directory',
          children: [],
        }
        current.children.push(child)
      }
      current = child
    }
  }

  sortTree(root)
  return root
}

export function filterRtlTreeFiles(root: RtlTreeNode, filePaths: string[]): RtlTreeNode {
  const allowed = new Set(filePaths.map((filePath) => normalizePath(filePath)))
  return pruneTree(root, allowed)
}

function pruneTree(node: RtlTreeNode, allowed: Set<string>): RtlTreeNode {
  if (node.kind === 'file') {
    return allowed.has(normalizePath(node.path)) ? node : emptyDirectory(node)
  }

  const children = node.children
    .map((child) => pruneTree(child, allowed))
    .filter((child) => child.kind === 'file' || child.children.length > 0)

  return {
    ...node,
    children,
  }
}

function emptyDirectory(node: RtlTreeNode): RtlTreeNode {
  return {
    ...node,
    kind: 'directory',
    children: [],
  }
}

function sortTree(node: RtlTreeNode): void {
  node.children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })
  for (const child of node.children) {
    sortTree(child)
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function getRelativePath(rootPath: string, filePath: string): string {
  const normalizedRoot = normalizePath(rootPath)
  const normalizedFile = normalizePath(filePath)
  if (normalizedFile === normalizedRoot) {
    return ''
  }
  const prefix = `${normalizedRoot}/`
  if (!normalizedFile.startsWith(prefix)) {
    return ''
  }
  return normalizedFile.slice(prefix.length)
}

function joinPath(rootPath: string, relativePath: string): string {
  return `${normalizePath(rootPath)}/${relativePath}`
}
