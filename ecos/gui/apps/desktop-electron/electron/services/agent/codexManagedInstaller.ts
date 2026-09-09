import { createWriteStream, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'
import type { DesktopCodexInstallProgressEvent } from '@ecos-studio/shared'

import { captureCommandOutput, type SpawnLike } from '../commandCapture'

export type FetchLike = typeof fetch
export type { SpawnLike }

const GITHUB_LATEST_DOWNLOAD_BASE =
  'https://github.com/openai/codex/releases/latest/download'
const OPENAI_RELEASES_BASE = 'https://releases.openai.com/codex'
// Managed downloads must stay bounded (~512 MB).
const MAX_MANAGED_DOWNLOAD_BYTES = 512 * 1024 * 1024

export interface ManagedCodexInstallContext {
  arch: string
  installRoot: string
  env: NodeJS.ProcessEnv
  fetchImpl: FetchLike
  spawnImpl: SpawnLike
  /** Registry write revision at install start (ABA guard for the commit). */
  baselineRevision: number | undefined
  onProgress(event: DesktopCodexInstallProgressEvent): void
  readVersion(bin: string): Promise<string | null>
  /**
   * Persist the managed binary path. Implementations run inside the
   * settings-registry key transaction and re-read the stored value, so a
   * Preferences write completed during the download wins.
   */
  persist(binPath: string, baselineRevision: number | undefined): Promise<void>
}

/**
 * Download, verify, and atomically install the managed Codex CLI binary. The
 * downloaded binary is verified (Codex version marker) before it replaces the
 * installed one; a backup keeps the previous version until the caller's
 * persistence step succeeds, so a failed install never takes effect.
 */
export async function installManagedCodex(
  context: ManagedCodexInstallContext,
): Promise<void> {
  const assetName = linuxAssetName(context.arch)
  if (!assetName) {
    throw new Error(`不支持的 Linux 架构: ${context.arch}`)
  }

  const downloadsDir = join(context.installRoot, 'downloads')
  const binDir = join(context.installRoot, 'bin')
  const archivePath = join(downloadsDir, assetName)
  const targetBin = join(binDir, 'codex')

  await mkdir(downloadsDir, { recursive: true })
  await mkdir(binDir, { recursive: true })

  context.onProgress({
    phase: 'downloading',
    message: '正在下载 Codex CLI…',
    progress: 0,
  })

  try {
    await downloadCodexArchive(context, assetName, archivePath, (progress) => {
      context.onProgress({
        phase: 'downloading',
        message: `正在下载 Codex CLI… ${Math.round(progress * 100)}%`,
        progress,
      })
    })
  } catch (error) {
    context.onProgress({
      phase: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  context.onProgress({
    phase: 'extracting',
    message: '正在解压 Codex CLI…',
    progress: 0.9,
  })

  const extractDir = await mkdtemp(join(tmpdir(), 'ecos-codex-'))
  let stagedBin: string | null = null
  let backupBin: string | null = null
  let verifiedVersion: string | null = null
  /** True once the staged binary replaced the target (rename succeeded). */
  let swapped = false
  /** True when a failed restore left the backup as the only old copy. */
  let preservedBackup = false
  try {
    await runTarExtract(captureCommandOutput, context.spawnImpl, archivePath, extractDir)
    const extractedBinary = await findExtractedCodexBinary(extractDir)
    if (!extractedBinary) {
      throw new Error('压缩包中未找到 Codex 可执行文件')
    }
    await chmod(extractedBinary, 0o755)

    context.onProgress({
      phase: 'verifying',
      message: '正在验证 Codex CLI…',
      progress: 0.97,
    })

    // Verify the downloaded binary BEFORE touching the installed one so a
    // failed install leaves the previous working version in place.
    verifiedVersion = await context.readVersion(extractedBinary)
    if (!verifiedVersion || !/^codex[\s_-]/i.test(verifiedVersion)) {
      throw new Error('下载内容不是有效的 Codex CLI')
    }

    await mkdir(dirname(targetBin), { recursive: true })
    // Keep a backup until the new binary is verified and persisted so a
    // post-rename failure can restore the previous managed version.
    const hadPreviousBinary = existsSync(targetBin)
    if (hadPreviousBinary) {
      backupBin = `${targetBin}.backup-${randomUUID()}`
      await copyFile(targetBin, backupBin)
    }
    // Stage next to the target and swap via rename, which atomically
    // replaces the target on Linux.
    stagedBin = `${targetBin}.staging-${randomUUID()}`
    await copyFile(extractedBinary, stagedBin)
    await chmod(stagedBin, 0o755)
    await rename(stagedBin, targetBin)
    stagedBin = null
    swapped = true

    await context.persist(targetBin, context.baselineRevision)
  } catch (error) {
    // Roll back the swap: restore the previous managed version, or remove
    // the freshly replaced binary on a first-time install so a failed
    // install never takes effect. A failed restore keeps the backup file on
    // disk (the finally skips it) and surfaces the failure alongside the
    // original error.
    let rollbackError: Error | null = null
    if (swapped) {
      if (backupBin) {
        try {
          await rename(backupBin, targetBin)
          backupBin = null
        } catch (restoreError) {
          preservedBackup = true
          rollbackError =
            restoreError instanceof Error ? restoreError : new Error(String(restoreError))
        }
      } else {
        try {
          await rm(targetBin, { force: true })
        } catch (removeError) {
          rollbackError =
            removeError instanceof Error ? removeError : new Error(String(removeError))
        }
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    context.onProgress({
      phase: 'error',
      message: rollbackError
        ? `${message}（回滚也失败: ${rollbackError.message}）`
        : message,
    })
    throw rollbackError
      ? new Error(`${message}；回滚失败: ${rollbackError.message}`)
      : error
  } finally {
    try {
      if (stagedBin) await rm(stagedBin, { force: true })
      // A backup whose restore failed stays on disk: it is the only copy of
      // the previous managed version.
      if (backupBin && !preservedBackup) await rm(backupBin, { force: true })
      await rm(extractDir, { force: true, recursive: true })
    } catch {
      // Cleanup errors must not mask the transaction result.
    }
  }

  // Emit done only after the transaction fully succeeded, so a throwing
  // progress listener can never trigger the rollback path above. The version
  // was already verified inside the transaction on identical bytes.
  context.onProgress({
    phase: 'done',
    message: `Codex CLI ${verifiedVersion ?? ''} 已安装`,
    progress: 1,
  })
}

async function downloadCodexArchive(
  context: Pick<ManagedCodexInstallContext, 'fetchImpl'>,
  assetName: string,
  destination: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  const urls = [
    `${OPENAI_RELEASES_BASE}/${assetName}`,
    `${GITHUB_LATEST_DOWNLOAD_BASE}/${assetName}`,
  ]
  let lastError: unknown
  for (const url of urls) {
    try {
      await downloadToFile(url, destination, context.fetchImpl, onProgress)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `下载 Codex CLI 失败: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

async function runTarExtract(
  capture: typeof captureCommandOutput,
  spawnImpl: SpawnLike,
  archivePath: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true })

  // Phase 1: member names (one per line) must all be relative and contained.
  const names = await capture(
    'tar',
    ['-tf', archivePath],
    { timeoutMs: 30_000 },
    spawnImpl,
  )
  if (names.code !== 0 || names.timedOut) {
    throw new Error(`tar failed: ${names.stderr.trim() || 'exit unknown'}`)
  }
  if (names.truncated) {
    throw new Error('archive 成员列表被截断，拒绝解压')
  }
  for (const rawName of names.stdout.split('\n')) {
    const member = rawName.trim()
    if (!member) continue
    const normalized = member.replace(/^\.\//, '')
    if (
      !normalized ||
      normalized.startsWith('/') ||
      normalized.split('/').includes('..')
    ) {
      throw new Error(`archive 包含不安全的成员路径: ${member}`)
    }
  }

  // Phase 2: link scan. Parse failures or truncation are fail-closed.
  const listing = await capture(
    'tar',
    ['-tvf', archivePath],
    { timeoutMs: 30_000 },
    spawnImpl,
  )
  if (listing.code !== 0 || listing.timedOut || listing.truncated) {
    throw new Error('archive 成员列表不完整或被截断，拒绝解压')
  }
  validateArchiveMembers(listing.stdout, destination)

  // Phase 3: extraction (members validated above).
  const result = await capture(
    'tar',
    ['-xf', archivePath, '-C', destination],
    { timeoutMs: 60_000 },
    spawnImpl,
  )
  if (result.code !== 0) {
    throw new Error(`tar failed: ${result.stderr.trim() || 'exit unknown'}`)
  }
}

/**
 * Validate a `tar -tvf` listing: member names must be relative and contained
 * in the destination, and symlink/hardlink entries must not escape it.
 */
function validateArchiveMembers(listing: string, destination: string): void {
  const root = resolve(destination)
  for (const rawLine of listing.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    // GNU tar -tv layout: mode owner/group size date time name[ -> target].
    // Names were already validated in phase 1; this pass only checks links.
    const prefixMatch = line.match(/^.{10}\s+\S+\s+\S+\s+\S+\s+\S+\s+/)
    if (!prefixMatch) {
      throw new Error(`archive 成员列表包含无法解析的行: ${line}`)
    }
    const rest = line.slice(prefixMatch[0].length)
    let name = rest
    let target: string | null = null
    const linkTo = rest.indexOf(' link to ')
    const arrow = rest.indexOf(' -> ')
    if (linkTo !== -1 && (arrow === -1 || linkTo < arrow)) {
      name = rest.slice(0, linkTo)
      target = rest.slice(linkTo + 9)
    } else if (arrow !== -1) {
      name = rest.slice(0, arrow)
      target = rest.slice(arrow + 4)
    }
    const normalized = name.replace(/^\.\//, '')
    if (
      !normalized ||
      normalized.startsWith('/') ||
      normalized.split('/').includes('..')
    ) {
      throw new Error(`archive 包含不安全的成员路径: ${name}`)
    }
    if (target !== null) {
      // Link targets must resolve inside the destination.
      const resolvedTarget = resolve(root, dirname(normalized), target)
      if (resolvedTarget !== root && !resolvedTarget.startsWith(root + sep)) {
        throw new Error(`archive 包含越界的链接目标: ${name} -> ${target}`)
      }
    }
  }
}

const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000

async function downloadToFile(
  url: string,
  destination: string,
  fetchImpl: FetchLike,
  onProgress: (progress: number) => void,
): Promise<void> {
  // Abort the download when no bytes arrive for a while, so a stalled source
  // cannot hold installPromise (and the UI) forever.
  const controller = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS)
  }
  armIdleTimer()
  const response = await fetchImpl(url, { redirect: 'follow', signal: controller.signal })
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}: ${url}`)
  }
  await mkdir(dirname(destination), { recursive: true })
  const totalHeader = response.headers.get('content-length')
  const totalBytes = totalHeader ? Number(totalHeader) : NaN
  if (!response.body) {
    const data = Buffer.from(await response.arrayBuffer())
    await writeFile(destination, new Uint8Array(data))
    onProgress(1)
    return
  }

  if (!response.body) {
    // Non-streaming response: enforce the size cap via the buffer.
    const data = await response.arrayBuffer()
    if (data.byteLength > MAX_MANAGED_DOWNLOAD_BYTES) {
      throw new Error(`下载超过大小上限 (${MAX_MANAGED_DOWNLOAD_BYTES} bytes)`)
    }
    await writeFile(destination, new Uint8Array(data))
    onProgress(1)
    return
  }

  const nodeStream = Readable.fromWeb(
    response.body as import('node:stream/web').ReadableStream,
  )
  const file = createWriteStream(destination)
  let downloaded = 0
  nodeStream.on('data', (chunk: Buffer | string) => {
    downloaded += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk)
    // Refuse runaway downloads (cap ~512 MB) so a compromised source cannot
    // exhaust the disk before the integrity checks run.
    if (downloaded > MAX_MANAGED_DOWNLOAD_BYTES) {
      nodeStream.destroy(
        new Error(`下载超过大小上限 (${MAX_MANAGED_DOWNLOAD_BYTES} bytes)`),
      )
      return
    }
    if (Number.isFinite(totalBytes) && totalBytes > 0) {
      onProgress(Math.min(downloaded / totalBytes, 0.99))
    }
  })
  nodeStream.on('data', () => armIdleTimer())
  await pipeline(nodeStream, file)
  if (idleTimer) clearTimeout(idleTimer)
  onProgress(1)
}

async function findExtractedCodexBinary(root: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(root, entry.name)
    if (entry.isFile() && (entry.name === 'codex' || entry.name.startsWith('codex-'))) {
      return fullPath
    }
    if (entry.isDirectory()) {
      const nested = await findExtractedCodexBinary(fullPath)
      if (nested) return nested
    }
  }
  return null
}

export function linuxAssetName(arch: string): string | null {
  if (arch === 'x64') return 'codex-x86_64-unknown-linux-musl.tar.gz'
  if (arch === 'arm64') return 'codex-aarch64-unknown-linux-musl.tar.gz'
  return null
}
