import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import {
  canonicalizeExistingDirectory,
  getLayoutTileCacheDir,
  validateProjectScopedPath,
  validateTileCacheOutDir,
} from './pathing.ts'

export interface PrepareLayoutTileCacheOptions {
  projectPath: string
  projectRoot: string
  stepKey: string
  layoutJsonPath: string
}

export interface PrepareLayoutTileCacheResult {
  outDir: string
  fromCache: boolean
  contentSha256: string
}

export type LayoutTileCacheStatusResult = PrepareLayoutTileCacheResult

export interface FinalizeLayoutTileCacheMetaOptions {
  projectRoot: string
  outDir: string
  layoutJsonPath: string
  contentSha256: string
}

export interface TileCacheMeta {
  layoutJsonPath: string
  contentSha256: string
  generatedAt: string
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function sha256HexFile(path: string): Promise<string> {
  const bytes = await readFile(path)
  const hasher = createHash('sha256')
  hasher.update(bytes)
  return hasher.digest('hex')
}

async function readMatchingCacheState(outDir: string, contentSha256: string): Promise<boolean> {
  const metaPath = `${outDir}/tile-cache.meta.json`
  const manifestPath = `${outDir}/manifest.json`

  if (!(await isFile(metaPath)) || !(await isFile(manifestPath))) {
    return false
  }

  const raw = await readFile(metaPath, 'utf8')
  const meta = JSON.parse(raw) as TileCacheMeta
  return meta.contentSha256 === contentSha256
}

export async function getLayoutTileCacheStatus(
  options: PrepareLayoutTileCacheOptions,
): Promise<LayoutTileCacheStatusResult> {
  const rootPath = await canonicalizeExistingDirectory(options.projectRoot)

  await validateProjectScopedPath(options.projectPath, rootPath)
  const layoutJsonPath = await validateProjectScopedPath(options.layoutJsonPath, rootPath)

  if (!(await isFile(layoutJsonPath))) {
    throw new Error(`布局 JSON 不存在: ${layoutJsonPath}`)
  }

  const contentSha256 = await sha256HexFile(layoutJsonPath)
  const outDir = await validateTileCacheOutDir(
    getLayoutTileCacheDir(rootPath, options.stepKey),
    rootPath,
  )

  return {
    outDir,
    fromCache: await readMatchingCacheState(outDir, contentSha256),
    contentSha256,
  }
}

export async function prepareLayoutTileCache(
  options: PrepareLayoutTileCacheOptions,
): Promise<PrepareLayoutTileCacheResult> {
  const rootPath = await canonicalizeExistingDirectory(options.projectRoot)

  await validateProjectScopedPath(options.projectPath, rootPath)
  const layoutJsonPath = await validateProjectScopedPath(options.layoutJsonPath, rootPath)

  if (!(await isFile(layoutJsonPath))) {
    throw new Error(`布局 JSON 不存在: ${layoutJsonPath}`)
  }

  const contentSha256 = await sha256HexFile(layoutJsonPath)
  const outDir = await validateTileCacheOutDir(
    getLayoutTileCacheDir(rootPath, options.stepKey),
    rootPath,
  )
  const fromCache = await readMatchingCacheState(outDir, contentSha256)

  if (!fromCache && await exists(outDir)) {
    await rm(outDir, { recursive: true, force: true })
  }

  await mkdir(outDir, { recursive: true })

  return {
    outDir,
    fromCache,
    contentSha256,
  }
}

export async function finalizeLayoutTileCacheMeta(
  options: FinalizeLayoutTileCacheMetaOptions,
): Promise<void> {
  const rootPath = await canonicalizeExistingDirectory(options.projectRoot)
  const outDir = await validateTileCacheOutDir(options.outDir, rootPath)
  const layoutJsonPath = await validateProjectScopedPath(options.layoutJsonPath, rootPath)
  const meta: TileCacheMeta = {
    layoutJsonPath,
    contentSha256: options.contentSha256,
    generatedAt: new Date().toISOString(),
  }

  await writeFile(
    `${outDir}/tile-cache.meta.json`,
    JSON.stringify(meta, null, 2),
    'utf8',
  )
}
