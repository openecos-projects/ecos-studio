import { access, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, relative } from 'node:path'
import type {
  WorkspaceDesignFileAddResult,
  WorkspaceDesignFileEntry,
} from '@ecos-studio/shared'
import {
  isHdlFilePath,
  joinLocalPath,
  normalizeLocalPath,
} from '@ecos-studio/shared'
import {
  appendFilelistEntry,
  parseFilelistContent,
  removeFilelistEntry,
  resolveFilelistPath,
  serializeFilelistLines,
} from './designFilelist'

const ORIGIN_DIR = 'origin'
const FILELIST_NAME = 'filelist'

export function getWorkspaceOriginDir(projectRoot: string): string {
  return joinLocalPath(normalizeLocalPath(projectRoot), ORIGIN_DIR)
}

export function getWorkspaceFilelistPath(projectRoot: string): string {
  return joinLocalPath(getWorkspaceOriginDir(projectRoot), FILELIST_NAME)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const normalizedRoot = normalizeLocalPath(rootPath).replace(/[\\/]+$/, '')
  const normalizedCandidate = normalizeLocalPath(candidatePath)
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}/`)
    || normalizedCandidate.startsWith(`${normalizedRoot}\\`)
}

function toOriginFilelistPath(path: string, originDir: string): string {
  return normalizeLocalPath(relative(originDir, path))
}

export async function listWorkspaceDesignFiles(
  projectRoot: string,
): Promise<WorkspaceDesignFileEntry[]> {
  const canonicalRoot = normalizeLocalPath(projectRoot)
  const originDir = getWorkspaceOriginDir(canonicalRoot)
  const filelistPath = getWorkspaceFilelistPath(canonicalRoot)

  let content = ''
  try {
    content = await readFile(filelistPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    return []
  }

  const entries: WorkspaceDesignFileEntry[] = []
  for (const line of parseFilelistContent(content)) {
    if (line.kind !== 'file') {
      continue
    }

    const resolvedPath = resolveFilelistPath(line.path, originDir)
    const managedInWorkspace = isPathWithinRoot(resolvedPath, originDir)
    entries.push({
      filelistEntry: line.raw,
      basename: basename(resolvedPath),
      resolvedPath,
      exists: await pathExists(resolvedPath),
      managedInWorkspace,
    })
  }

  return entries
}

export async function addWorkspaceDesignFiles(
  projectRoot: string,
  sourcePaths: string[],
): Promise<WorkspaceDesignFileAddResult> {
  const canonicalRoot = normalizeLocalPath(projectRoot)
  const originDir = getWorkspaceOriginDir(canonicalRoot)
  const filelistPath = getWorkspaceFilelistPath(canonicalRoot)
  await mkdir(originDir, { recursive: true })

  const existingContent = await readFile(filelistPath, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  })

  let lines = existingContent ? parseFilelistContent(existingContent) : []
  const existingEntries = await listWorkspaceDesignFiles(canonicalRoot)
  const existingResolved = new Set(existingEntries.map((entry) => entry.resolvedPath))

  const added: WorkspaceDesignFileEntry[] = []
  const skipped: WorkspaceDesignFileAddResult['skipped'] = []

  for (const rawPath of sourcePaths) {
    const normalizedSource = normalizeLocalPath(rawPath)
    if (!isHdlFilePath(normalizedSource)) {
      skipped.push({
        path: rawPath,
        reason: 'Not an RTL design file (.v, .sv, .vhd, .vhdl).',
      })
      continue
    }

    let sourceStat
    try {
      sourceStat = await stat(normalizedSource)
    } catch {
      skipped.push({
        path: rawPath,
        reason: 'File does not exist.',
      })
      continue
    }

    if (!sourceStat.isFile()) {
      skipped.push({
        path: rawPath,
        reason: 'Only files can be added. Use Add RTL Folder for directories.',
      })
      continue
    }

    const sourceInOrigin = isPathWithinRoot(normalizedSource, originDir)
    const managedPath = sourceInOrigin
      ? normalizedSource
      : joinLocalPath(originDir, basename(normalizedSource))
    const filelistPath = toOriginFilelistPath(managedPath, originDir)

    if (existingResolved.has(managedPath)) {
      skipped.push({
        path: rawPath,
        reason: 'File is already listed in the workspace filelist.',
      })
      continue
    }

    if (!sourceInOrigin && await pathExists(managedPath)) {
      skipped.push({
        path: rawPath,
        reason: `${basename(normalizedSource)} already exists in workspace/origin.`,
      })
      continue
    }

    if (!sourceInOrigin) {
      await copyFile(normalizedSource, managedPath)
    }

    lines = appendFilelistEntry(lines, filelistPath)
    existingResolved.add(managedPath)

    added.push({
      filelistEntry: lines[lines.length - 1]?.kind === 'file' ? lines[lines.length - 1]!.raw : filelistPath,
      basename: basename(managedPath),
      resolvedPath: managedPath,
      exists: true,
      managedInWorkspace: true,
    })
  }

  if (added.length > 0) {
    await writeFile(filelistPath, serializeFilelistLines(lines), 'utf8')
  }

  return { added, skipped }
}

export async function removeWorkspaceDesignFile(
  projectRoot: string,
  filelistEntry: string,
): Promise<WorkspaceDesignFileEntry | null> {
  const canonicalRoot = normalizeLocalPath(projectRoot)
  const originDir = getWorkspaceOriginDir(canonicalRoot)
  const filelistPath = getWorkspaceFilelistPath(canonicalRoot)

  const existingContent = await readFile(filelistPath, 'utf8')
  const lines = parseFilelistContent(existingContent)
  const targetLine = lines.find((line) => line.kind === 'file' && line.raw === filelistEntry)
  if (!targetLine || targetLine.kind !== 'file') {
    return null
  }

  const resolvedPath = resolveFilelistPath(targetLine.path, originDir)
  const nextLines = removeFilelistEntry(lines, filelistEntry)
  await writeFile(filelistPath, serializeFilelistLines(nextLines), 'utf8')

  if (isPathWithinRoot(resolvedPath, originDir) && await pathExists(resolvedPath)) {
    const resolvedStat = await stat(resolvedPath)
    if (resolvedStat.isFile()) {
      await rm(resolvedPath, { force: true })
    }
  }

  return {
    filelistEntry,
    basename: basename(resolvedPath),
    resolvedPath,
    exists: await pathExists(resolvedPath),
    managedInWorkspace: isPathWithinRoot(resolvedPath, originDir),
  }
}

export async function readWorkspaceFilelistPath(projectRoot: string): Promise<string | null> {
  const filelistPath = getWorkspaceFilelistPath(projectRoot)
  return await pathExists(filelistPath) ? filelistPath : null
}
