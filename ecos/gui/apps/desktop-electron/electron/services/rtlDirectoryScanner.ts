import { readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeLocalPath } from '@ecos-studio/shared'
import { isHdlFilePath } from './designFilelist'

export interface ScannedRtlDirectory {
  rootPath: string
  files: string[]
}

const SKIP_DIR_NAMES = new Set([
  '.git',
  '.ecc',
  'node_modules',
  'build',
  'dist',
  'target',
])

export async function scanRtlDirectory(path: string): Promise<ScannedRtlDirectory> {
  const canonicalPath = normalizeLocalPath(await realpath(path))
  const files: string[] = []
  await walkDirectory(canonicalPath, files)
  files.sort((left, right) => left.localeCompare(right))
  return {
    rootPath: canonicalPath,
    files,
  }
}

async function walkDirectory(currentPath: string, files: string[]): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(currentPath, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        continue
      }
      await walkDirectory(entryPath, files)
      continue
    }

    if (entry.isFile() && isHdlFilePath(entryPath)) {
      files.push(normalizeLocalPath(entryPath))
    }
  }
}
