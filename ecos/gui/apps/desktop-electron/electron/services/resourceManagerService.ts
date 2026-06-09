import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, copyFile, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { electronLogger } from './logger'
import type {
  ResourceAction,
  ResourceInfo,
  ResourceJob,
  ResourceList,
  ResourceOperationResult,
  ResourceStatus,
} from '@ecos-studio/shared'

const DEFAULT_REGISTRY_URL = 'https://emin017.github.io/ecos-registry/tool-registry.json'
const ALL_PLATFORM = 'all-platform'
const TOP_LEVEL_ENTRY_LIMIT = 20
const COMMAND_ERROR_OUTPUT_LIMIT = 2048

type ResourceInventoryEntry = ToolInventoryEntry | PdkInventoryEntry
type ArchiveExtractor = (archivePath: string, destination: string, stripPrefix?: string | null) => Promise<void>
type CommandRunner = (command: string, args: string[], options?: CommandRunnerOptions) => Promise<void>
type DownloadProgressListener = (progress: DownloadProgress) => void
type Sha256Verifier = (filePath: string, expected: string) => Promise<boolean>

interface CommandRunnerOptions {
  cwd?: string
}

interface DownloadProgress {
  downloadedBytes: number
  progress: number
  totalBytes: number | null
}

interface PlatformAsset {
  url: string
  sha256: string
  size: number
  strip_prefix?: string | null
  post_install: RegistryPostInstallStep[]
}

interface RegistryPostInstallStep {
  command: string[]
  cwd: string
}

interface RegistryToolVersion {
  version: string
  platforms: Record<string, PlatformAsset>
}

interface RegistryTool {
  name: string
  display_name: string
  description: string
  category: string
  homepage: string
  versions: RegistryToolVersion[]
}

interface RegistryPdkVersion {
  version: string
  platforms: Record<string, PlatformAsset>
}

interface RegistryPdk {
  id: string
  display_name: string
  description?: string
  category?: string
  homepage?: string
  versions: RegistryPdkVersion[]
}

interface ResourceRegistry {
  schema_version: number
  tools: RegistryTool[]
  pdks: RegistryPdk[]
}

interface ToolInventoryEntry {
  type: 'tool'
  name: string
  version: string
  path: string
  installed_at: string
  sha256: string
  detected_executables: string[]
  executable: string
  active: boolean
  managed: boolean
}

interface PdkInventoryEntry {
  type: 'pdk'
  id: string
  name: string
  pdk_id: string
  version: string
  sha256: string
  source: string
  source_url: string
  canonical_path: string
  path: string
  detected_files: string[]
  detected_file_groups: {
    directories: string[]
    files: string[]
  }
  imported_at: string
  active: boolean
  managed: boolean
  health: string
}

interface ResourceManifest {
  schema_version: number
  resources_dir: string
  tools_dir: string
  pdks_dir: string
  installed: Record<string, ResourceInventoryEntry>
}

interface RegistryState {
  registry: ResourceRegistry | null
  diagnostics: string[]
}

interface RegistryCacheResult {
  registry: ResourceRegistry | null
  diagnostics: string[]
}

interface ActiveResourceJob {
  action: ResourceAction
  controller: AbortController
  listener?: (event: ResourceJob) => void
}

export interface ResourceManagerServiceOptions {
  archiveExtractor?: ArchiveExtractor
  cacheDir?: string
  commandRunner?: CommandRunner
  fetchImpl?: typeof fetch
  pdksDir?: string
  registryUrl?: string
  resourcesDir?: string
  sha256Verifier?: Sha256Verifier
  toolsDir?: string
}

export interface RuntimeEnvOptions {
  platform: NodeJS.Platform
}

export class ResourceManagerService {
  private readonly archiveExtractor: ArchiveExtractor
  private readonly cacheDir: string
  private readonly commandRunner: CommandRunner
  private readonly fetchImpl: typeof fetch
  private readonly manifestPath: string
  private readonly pdksDir: string
  private readonly registryUrl: string
  private readonly resourcesDir: string
  private readonly sha256Verifier: Sha256Verifier
  private readonly toolsDir: string

  private registryMemory: ResourceRegistry | null = null
  private registryRefreshPromise: Promise<void> | null = null
  private activeJobs = new Map<string, ActiveResourceJob>()

  constructor(options: ResourceManagerServiceOptions = {}) {
    this.resourcesDir = options.resourcesDir ?? join(xdgStateHome(), 'ecos-studio', 'resources')
    this.toolsDir = options.toolsDir ?? join(xdgDataHome(), 'ecos-studio', 'tools')
    this.pdksDir = options.pdksDir ?? join(xdgDataHome(), 'ecos-studio', 'pdks')
    this.cacheDir = options.cacheDir ?? join(xdgCacheHome(), 'ecos-studio')
    this.manifestPath = join(this.resourcesDir, 'manifest.json')
    this.registryUrl = options.registryUrl ?? process.env.ECOS_REGISTRY_URL ?? DEFAULT_REGISTRY_URL
    this.commandRunner = options.commandRunner ?? runCommand
    this.fetchImpl = options.fetchImpl ?? fetch
    this.archiveExtractor = options.archiveExtractor ?? extractArchive
    this.sha256Verifier = options.sha256Verifier ?? verifySha256
  }

  async listResources(): Promise<ResourceList> {
    const state = await this.fetchRegistry()
    const manifest = await this.readManifest()
    const installedTools = getInstalledTools(manifest)
    const installedPdks = getInstalledPdks(manifest)
    const resources: ResourceInfo[] = []

    for (const tool of state.registry?.tools ?? []) {
      resources.push(this.registryToolToResource(tool, installedTools))
    }
    for (const pdk of state.registry?.pdks ?? []) {
      const local = installedPdks[pdk.id]
      if (!local) resources.push(this.registryPdkToResource(pdk))
    }
    for (const [name, entry] of Object.entries(installedTools)) {
      if (!resources.some((resource) => resource.id === `tool:${name}`)) {
        resources.push(this.installedToolToResource(name, entry))
      }
    }
    for (const [id, entry] of Object.entries(installedPdks)) {
      resources.push(this.pdkEntryToResource(entry, this.findRegistryPdk(state.registry, id)))
    }

    return {
      diagnostics: state.diagnostics,
      resources,
    }
  }

  async getResource(resourceId: string): Promise<ResourceInfo> {
    const resource = (await this.listResources()).resources.find((item) => item.id === resourceId)
    if (!resource) {
      throw new Error(`Resource '${resourceId}' not found`)
    }
    return resource
  }

  async createRuntimeEnv(
    baseEnv: NodeJS.ProcessEnv,
    options: RuntimeEnvOptions,
  ): Promise<NodeJS.ProcessEnv> {
    const env = { ...baseEnv }
    const manifest = await this.readRuntimeManifest()
    const toolBinDirs: string[] = []
    let activeYosysRoot: string | null = null

    for (const entry of Object.values(manifest.installed)) {
      if (!isToolEntry(entry) || !entry.active) continue

      const executablePath = join(entry.path, entry.executable)
      if (!await isUsableExecutable(executablePath, options.platform)) {
        electronLogger.debug(
          '[resources] Skipping runtime tool %s: executable is missing or not executable at %s',
          entry.name,
          executablePath,
        )
        continue
      }

      toolBinDirs.push(dirname(executablePath))
      if (entry.name === 'yosys') {
        activeYosysRoot = entry.path
      }
    }

    if (toolBinDirs.length > 0) {
      const pathKey = pathKeyForRuntimeEnv(env)
      env[pathKey] = mergeRuntimePath(env[pathKey] ?? '', toolBinDirs, options.platform)
    }

    if (activeYosysRoot) {
      env.CHIPCOMPILER_OSS_CAD_DIR = activeYosysRoot
      env.ECOS_ELECTRON_OSS_CAD_DIR = activeYosysRoot
    }

    for (const entry of Object.values(manifest.installed)) {
      if (!isPdkEntry(entry) || !entry.active || entry.health !== 'ok') continue
      if (!await isExistingDirectory(entry.canonical_path)) {
        electronLogger.debug(
          '[resources] Skipping runtime PDK %s: canonical path is missing at %s',
          entry.id,
          entry.canonical_path,
        )
        continue
      }

      const pdkId = (entry.pdk_id || entry.id).toUpperCase().replace(/[^A-Z0-9]/g, '_')
      env[`CHIPCOMPILER_${pdkId}_PDK_ROOT`] = entry.canonical_path
      if (pdkId === 'ICS55') {
        env.ICS55_PDK_ROOT = entry.canonical_path
      }
    }

    return env
  }

  async installResource(
    resourceId: string,
    version?: string,
    listener?: (event: ResourceJob) => void,
  ): Promise<ResourceOperationResult> {
    if (resourceId.startsWith('tool:')) {
      return await this.installTool(resourceId.slice('tool:'.length), version, 'install', listener)
    }
    if (resourceId.startsWith('pdk:')) {
      return await this.installPdk(resourceId.slice('pdk:'.length), version, 'install', listener)
    }
    throw new Error(`Install is not implemented for ${resourceId}`)
  }

  async updateResource(
    resourceId: string,
    listener?: (event: ResourceJob) => void,
  ): Promise<ResourceOperationResult> {
    if (resourceId.startsWith('tool:')) {
      return await this.installTool(resourceId.slice('tool:'.length), undefined, 'update', listener)
    }
    if (resourceId.startsWith('pdk:')) {
      return await this.installPdk(resourceId.slice('pdk:'.length), undefined, 'update', listener)
    }
    throw new Error(`Update is not implemented for ${resourceId}`)
  }

  async cancelResource(resourceId: string): Promise<ResourceOperationResult> {
    const job = this.activeJobs.get(resourceId)
    if (!job) {
      throw new Error(`No active job for ${resourceId}`)
    }
    job.controller.abort()
    return { status: 'cancelled', resource_id: resourceId }
  }

  async uninstallResource(resourceId: string): Promise<ResourceOperationResult> {
    if (!resourceId.startsWith('tool:')) {
      if (resourceId.startsWith('pdk:')) {
        await this.removeManagedPdk(resourceId.slice('pdk:'.length))
        return { status: 'uninstalled', resource_id: resourceId }
      }
      throw new Error(`Unsupported resource id: ${resourceId}`)
    }

    const name = resourceId.slice('tool:'.length)
    const manifest = await this.readManifest()
    const entry = manifest.installed[resourceId]
    if (!isToolEntry(entry)) {
      throw new Error(`Tool '${name}' is not installed`)
    }
    if (!entry.managed) {
      throw new Error(`Tool '${name}' is unmanaged and cannot be uninstalled`)
    }
    await rm(entry.path, { force: true, recursive: true })
    delete manifest.installed[resourceId]
    await this.writeManifest(manifest)
    return { status: 'uninstalled', resource_id: resourceId }
  }

  async activatePdk(resourceId: string): Promise<ResourceOperationResult> {
    const pdkId = resourceNameFromId(resourceId, 'pdk')
    const manifest = await this.readManifest()
    const entry = manifest.installed[`pdk:${pdkId}`]
    if (!isPdkEntry(entry)) {
      throw new Error(`PDK '${pdkId}' not found in inventory`)
    }
    for (const [id, candidate] of Object.entries(manifest.installed)) {
      if (isPdkEntry(candidate)) {
        candidate.active = id === `pdk:${pdkId}`
      }
    }
    await this.writeManifest(manifest)
    return { status: 'activated', resource_id: `pdk:${pdkId}` }
  }

  async validatePdk(resourceId: string): Promise<{ resource_id: string; health: { status: string } }> {
    const pdkId = resourceNameFromId(resourceId, 'pdk')
    const manifest = await this.readManifest()
    const entry = manifest.installed[`pdk:${pdkId}`]
    if (!isPdkEntry(entry)) {
      throw new Error(`PDK '${pdkId}' not found in inventory`)
    }

    let health = 'ok'
    try {
      const pathStats = await stat(entry.canonical_path)
      health = pathStats.isDirectory() ? 'ok' : 'invalid'
    } catch {
      health = 'missing'
    }
    entry.health = health
    await this.writeManifest(manifest)
    return { resource_id: `pdk:${pdkId}`, health: { status: health } }
  }

  async removePdkReference(resourceId: string): Promise<ResourceOperationResult> {
    const pdkId = resourceNameFromId(resourceId, 'pdk')
    const manifest = await this.readManifest()
    const entry = manifest.installed[`pdk:${pdkId}`]
    if (!entry) {
      throw new Error(`PDK '${pdkId}' not found`)
    }
    if (isPdkEntry(entry) && entry.managed) {
      throw new Error(`PDK '${pdkId}' is managed and cannot remove reference; use uninstall`)
    }
    delete manifest.installed[`pdk:${pdkId}`]
    await this.writeManifest(manifest)
    return { status: 'removed', resource_id: `pdk:${pdkId}` }
  }

  async importPdkPath(path: string): Promise<ResourceInfo> {
    const scanned = await scanPdkDirectory(path)
    const manifest = await this.readManifest()
    const activePdk = Object.values(manifest.installed).find((entry) => isPdkEntry(entry) && entry.active)
    const resourceId = `pdk:${scanned.pdkId}`
    manifest.installed[resourceId] = {
      type: 'pdk',
      id: scanned.pdkId,
      name: scanned.name,
      pdk_id: scanned.pdkId,
      version: '',
      sha256: '',
      source: 'local',
      source_url: '',
      canonical_path: scanned.canonicalPath,
      path: scanned.canonicalPath,
      detected_files: [...scanned.detectedFiles.directories, ...scanned.detectedFiles.files],
      detected_file_groups: scanned.detectedFiles,
      imported_at: utcNowIso(),
      active: activePdk == null,
      managed: false,
      health: 'ok',
    }
    await this.writeManifest(manifest)
    return this.pdkEntryToResource(manifest.installed[resourceId] as PdkInventoryEntry)
  }

  async refreshRegistry(): Promise<{ status: string; tools_count: number }> {
    const state = await this.fetchRegistry(true)
    return {
      status: state.registry ? 'refreshed' : 'degraded',
      tools_count: state.registry?.tools.length ?? 0,
    }
  }

  private async installTool(
    name: string,
    requestedVersion: string | undefined,
    action: ResourceAction,
    listener?: (event: ResourceJob) => void,
  ): Promise<ResourceOperationResult> {
    const resourceId = `tool:${name}`
    if (this.activeJobs.has(resourceId)) {
      throw new Error(`Job already active for ${resourceId}`)
    }
    const controller = new AbortController()
    this.activeJobs.set(resourceId, { action, controller, listener })
    let tempArchive = ''
    let tempExtract = ''

    try {
      const state = await this.fetchRegistry()
      const tool = state.registry?.tools.find((candidate) => candidate.name === name)
      if (!tool) throw new Error(`Tool '${name}' not found in registry`)
      const versionEntry = requestedVersion
        ? tool.versions.find((candidate) => candidate.version === requestedVersion)
        : tool.versions[0]
      if (!versionEntry) throw new Error(`Version not found for ${name}`)
      const { platform, asset } = selectPlatformAsset(versionEntry)
      if (!asset) throw new Error(`No asset for ${name} on ${platform}`)
      const version = versionEntry.version
      const destination = join(this.toolsDir, name, version)
      tempArchive = join(this.resourcesDir, 'downloads', `${name}-${version}-${randomUUID()}.archive`)
      tempExtract = join(this.toolsDir, name, `.extract-${version}-${randomUUID()}`)

      await mkdir(dirname(tempArchive), { recursive: true })
      electronLogger.info(
        '[resources] %s %s v%s on %s',
        action === 'update' ? 'Updating' : 'Installing',
        resourceId,
        version,
        platform,
      )
      electronLogger.debug(
        '[resources] Download source for %s: %s -> %s (%d bytes)',
        resourceId,
        asset.url,
        tempArchive,
        asset.size,
      )
      this.publish(listener, { resource_id: resourceId, action, phase: 'downloading', progress: 0, message: `Downloading ${name} v${version}...` })
      await downloadAsset(asset.url, tempArchive, this.fetchImpl, asset.size, (progress) => {
        const totalLabel = progress.totalBytes === null ? '?' : formatBytes(progress.totalBytes)
        this.publish(listener, {
          resource_id: resourceId,
          action,
          phase: 'downloading',
          progress: progress.progress,
          message: `Downloading ${name} v${version} (${formatBytes(progress.downloadedBytes)} / ${totalLabel})...`,
        })
        electronLogger.debug(
          '[resources] Download progress for %s: %d/%s bytes (%d%%)',
          resourceId,
          progress.downloadedBytes,
          progress.totalBytes ?? '?',
          Math.round(progress.progress * 100),
        )
      }, controller.signal)
      throwIfAborted(controller.signal)
      this.publish(listener, { resource_id: resourceId, action, phase: 'verifying', progress: 0, message: 'Verifying SHA256...' })
      electronLogger.debug('[resources] Verifying %s with SHA256 %s', resourceId, asset.sha256 || '(not provided)')
      const verified = await this.sha256Verifier(tempArchive, asset.sha256)
      if (!verified) {
        throw new Error(`SHA256 verification failed for ${name}`)
      }
      throwIfAborted(controller.signal)
      electronLogger.debug('[resources] Extracting %s into %s', resourceId, destination)
      await rm(tempExtract, { force: true, recursive: true })
      await this.withExtractProgress(resourceId, action, name, listener, async () => {
        await this.archiveExtractor(tempArchive, tempExtract, asset.strip_prefix)
      })
      throwIfAborted(controller.signal)
      await rm(destination, { force: true, recursive: true })
      await mkdir(dirname(destination), { recursive: true })
      await rm(destination, { force: true, recursive: true })
      await rename(tempExtract, destination)
      throwIfAborted(controller.signal)

      const detected = await detectExecutables(destination)
      const manifest = await this.readManifest()
      manifest.installed[resourceId] = {
        type: 'tool',
        name,
        version,
        path: destination,
        installed_at: utcNowIso(),
        sha256: asset.sha256,
        detected_executables: detected,
        executable: detected[0] ?? `bin/${name}`,
        active: true,
        managed: true,
      }
      await this.writeManifest(manifest)
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: 'done',
        progress: 1,
        message: `${name} v${version} installed successfully`,
      })
      electronLogger.info('[resources] Installed %s v%s at %s', resourceId, version, destination)
      return { status: 'started', resource_id: resourceId, version }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isAbortError(error) || controller.signal.aborted) {
        const cancelMessage = `Cancelled download for ${resourceId}`
        electronLogger.info('[resources] Cancelled %s', resourceId)
        this.publish(listener, {
          resource_id: resourceId,
          action,
          phase: 'cancelled',
          progress: 0,
          message: cancelMessage,
          error: cancelMessage,
        })
        throw new Error(cancelMessage, { cause: error })
      }
      electronLogger.error('[resources] Failed to install %s: %s', resourceId, message)
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: 'error',
        progress: 0,
        message,
        error: message,
      })
      throw error
    } finally {
      this.activeJobs.delete(resourceId)
      if (tempArchive) await rm(tempArchive, { force: true }).catch(() => undefined)
      if (tempExtract) await rm(tempExtract, { force: true, recursive: true }).catch(() => undefined)
    }
  }

  private async installPdk(
    pdkId: string,
    requestedVersion: string | undefined,
    action: ResourceAction,
    listener?: (event: ResourceJob) => void,
  ): Promise<ResourceOperationResult> {
    const resourceId = `pdk:${pdkId}`
    if (this.activeJobs.has(resourceId)) {
      throw new Error(`Job already active for ${resourceId}`)
    }
    const controller = new AbortController()
    this.activeJobs.set(resourceId, { action, controller, listener })
    let tempArchive = ''
    let tempExtract = ''

    try {
      const state = await this.fetchRegistry()
      const pdk = state.registry?.pdks.find((candidate) => candidate.id === pdkId)
      if (!pdk) throw new Error(`PDK '${pdkId}' not found in registry`)
      const versionEntry = requestedVersion
        ? pdk.versions.find((candidate) => candidate.version === requestedVersion)
        : pdk.versions[0]
      if (!versionEntry) throw new Error(`Version not found for ${pdkId}`)
      const { platform, asset } = selectPlatformAsset(versionEntry)
      if (!asset) throw new Error(`No asset for ${pdkId} on ${platform}`)
      const version = versionEntry.version
      const displayName = pdk.display_name || pdkId
      const destination = join(this.pdksDir, pdkId, version)
      tempArchive = join(this.resourcesDir, 'downloads', `${pdkId}-${version}-${randomUUID()}.archive`)
      tempExtract = join(this.pdksDir, pdkId, `.extract-${version}-${randomUUID()}`)

      await mkdir(dirname(tempArchive), { recursive: true })
      electronLogger.info(
        '[resources] %s %s v%s on %s',
        action === 'update' ? 'Updating' : 'Installing',
        resourceId,
        version,
        platform,
      )
      electronLogger.debug(
        '[resources] Download source for %s: %s -> %s (%d bytes)',
        resourceId,
        asset.url,
        tempArchive,
        asset.size,
      )
      this.publish(listener, { resource_id: resourceId, action, phase: 'downloading', progress: 0, message: `Downloading ${displayName} v${version}...` })
      await downloadAsset(asset.url, tempArchive, this.fetchImpl, asset.size, (progress) => {
        const totalLabel = progress.totalBytes === null ? '?' : formatBytes(progress.totalBytes)
        this.publish(listener, {
          resource_id: resourceId,
          action,
          phase: 'downloading',
          progress: progress.progress,
          message: `Downloading ${displayName} v${version} (${formatBytes(progress.downloadedBytes)} / ${totalLabel})...`,
        })
        electronLogger.debug(
          '[resources] Download progress for %s: %d/%s bytes (%d%%)',
          resourceId,
          progress.downloadedBytes,
          progress.totalBytes ?? '?',
          Math.round(progress.progress * 100),
        )
      }, controller.signal)
      throwIfAborted(controller.signal)
      this.publish(listener, { resource_id: resourceId, action, phase: 'verifying', progress: 0, message: 'Verifying SHA256...' })
      electronLogger.debug('[resources] Verifying %s with SHA256 %s', resourceId, asset.sha256 || '(not provided)')
      const verified = await this.sha256Verifier(tempArchive, asset.sha256)
      if (!verified) {
        throw new Error(`SHA256 verification failed for ${pdkId}`)
      }
      throwIfAborted(controller.signal)
      electronLogger.debug('[resources] Extracting %s into %s', resourceId, destination)
      await rm(tempExtract, { force: true, recursive: true })
      await this.withExtractProgress(resourceId, action, displayName, listener, async () => {
        await this.archiveExtractor(tempArchive, tempExtract, asset.strip_prefix)
      })
      throwIfAborted(controller.signal)
      await rm(destination, { force: true, recursive: true })
      await mkdir(dirname(destination), { recursive: true })
      await rename(tempExtract, destination)
      await this.preDownloadPdkReleaseAssets(resourceId, action, displayName, destination, version, asset, listener, controller.signal)
      throwIfAborted(controller.signal)
      await this.runPostInstallSteps(resourceId, action, displayName, destination, asset.post_install, listener)
      throwIfAborted(controller.signal)

      const scanned = await scanPdkDirectory(destination)
      const manifest = await this.readManifest()
      const previous = manifest.installed[resourceId]
      const hasOtherActivePdk = Object.entries(manifest.installed).some(([id, entry]) => {
        return id !== resourceId && isPdkEntry(entry) && entry.active
      })
      const active = isPdkEntry(previous) ? previous.active || !hasOtherActivePdk : !hasOtherActivePdk
      if (active) {
        for (const [id, entry] of Object.entries(manifest.installed)) {
          if (id !== resourceId && isPdkEntry(entry)) {
            entry.active = false
          }
        }
      }
      manifest.installed[resourceId] = {
        type: 'pdk',
        id: pdkId,
        name: scanned.name || displayName,
        pdk_id: pdkId,
        version,
        sha256: asset.sha256,
        source: 'registry',
        source_url: asset.url,
        canonical_path: destination,
        path: destination,
        detected_files: [...scanned.detectedFiles.directories, ...scanned.detectedFiles.files],
        detected_file_groups: scanned.detectedFiles,
        imported_at: utcNowIso(),
        active,
        managed: true,
        health: 'ok',
      }
      await this.writeManifest(manifest)
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: 'done',
        progress: 1,
        message: `${displayName} v${version} installed successfully`,
      })
      electronLogger.info('[resources] Installed %s v%s at %s', resourceId, version, destination)
      return { status: 'started', resource_id: resourceId, version }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isAbortError(error) || controller.signal.aborted) {
        const cancelMessage = `Cancelled download for ${resourceId}`
        electronLogger.info('[resources] Cancelled %s', resourceId)
        this.publish(listener, {
          resource_id: resourceId,
          action,
          phase: 'cancelled',
          progress: 0,
          message: cancelMessage,
          error: cancelMessage,
        })
        throw new Error(cancelMessage, { cause: error })
      }
      electronLogger.error('[resources] Failed to install %s: %s', resourceId, message)
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: 'error',
        progress: 0,
        message,
        error: message,
      })
      throw error
    } finally {
      this.activeJobs.delete(resourceId)
      if (tempArchive) await rm(tempArchive, { force: true }).catch(() => undefined)
      if (tempExtract) await rm(tempExtract, { force: true, recursive: true }).catch(() => undefined)
    }
  }

  private async runPostInstallSteps(
    resourceId: string,
    action: ResourceAction,
    name: string,
    destination: string,
    steps: RegistryPostInstallStep[],
    listener?: (event: ResourceJob) => void,
  ): Promise<void> {
    for (const [index, step] of steps.entries()) {
      const [command, ...args] = step.command
      if (!command) continue
      const cwd = resolveInside(destination, step.cwd || '.')
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: 'post_install',
        progress: 0.98,
        message: `Running post-install step ${index + 1}/${steps.length} for ${name}: ${command}`,
      })
      await this.commandRunner(command, args, { cwd })
    }
  }

  private async preDownloadPdkReleaseAssets(
    resourceId: string,
    action: ResourceAction,
    name: string,
    destination: string,
    version: string,
    asset: PlatformAsset,
    listener?: (event: ResourceJob) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (asset.post_install.length === 0) return
    const assetNames = await readPdkReleaseAssetNames(destination)
    const baseUrl = releaseDownloadBaseUrl(asset.url, version)
    if (!baseUrl || assetNames.length === 0) return

    for (const [index, assetName] of assetNames.entries()) {
      const targetPath = join(destination, assetName)
      if (await pathExists(targetPath)) continue
      const downloadUrl = `${baseUrl}/${encodeURIComponent(assetName)}`
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: 'post_install',
        progress: 0.98,
        message: `Downloading ${name} post-install asset ${index + 1}/${assetNames.length}: ${assetName}`,
      })
      await downloadAsset(downloadUrl, targetPath, this.fetchImpl, null, undefined, signal)
    }
  }

  private async removeManagedPdk(pdkId: string): Promise<void> {
    const manifest = await this.readManifest()
    const entry = manifest.installed[`pdk:${pdkId}`]
    if (!isPdkEntry(entry)) {
      throw new Error(`PDK '${pdkId}' is not installed`)
    }
    if (!entry.managed) {
      throw new Error(`PDK '${pdkId}' is unmanaged and cannot be uninstalled`)
    }
    await rm(entry.canonical_path, { force: true, recursive: true })
    delete manifest.installed[`pdk:${pdkId}`]
    await this.writeManifest(manifest)
  }

  private async fetchRegistry(force = false): Promise<RegistryState> {
    if (this.registryMemory && !force) {
      return { registry: this.registryMemory, diagnostics: [] }
    }

    const cacheFile = registryCachePath(this.cacheDir, this.registryUrl)
    if (!force) {
      const cached = await this.readCachedRegistry(cacheFile)
      if (cached.registry) {
        this.refreshRegistryInBackground(cacheFile)
        return cached
      }
    }

    const diagnostics: string[] = []
    try {
      const registry = await readRegistryFromUrl(this.registryUrl, this.fetchImpl)
      await mkdir(dirname(cacheFile), { recursive: true })
      await writeFile(cacheFile, JSON.stringify(registry, null, 2), 'utf8')
      this.registryMemory = registry
      return { registry, diagnostics }
    } catch {
      diagnostics.push(`Registry unavailable at ${this.registryUrl}`)
    }

    try {
      const registry = parseRegistry(JSON.parse(await readFile(cacheFile, 'utf8')))
      this.registryMemory = registry
      diagnostics.push('Using cached registry data (may be outdated)')
      return { registry, diagnostics }
    } catch {
      diagnostics.push('No registry data available')
      return { registry: null, diagnostics }
    }
  }

  private async readCachedRegistry(cacheFile: string): Promise<RegistryCacheResult> {
    try {
      const registry = parseRegistry(JSON.parse(await readFile(cacheFile, 'utf8')))
      this.registryMemory = registry
      return {
        registry,
        diagnostics: ['Using cached registry data while refreshing in background'],
      }
    } catch {
      return { registry: null, diagnostics: [] }
    }
  }

  private refreshRegistryInBackground(cacheFile: string): void {
    if (this.registryRefreshPromise) return
    this.registryRefreshPromise = (async () => {
      try {
        const registry = await readRegistryFromUrl(this.registryUrl, this.fetchImpl)
        await mkdir(dirname(cacheFile), { recursive: true })
        await writeFile(cacheFile, JSON.stringify(registry, null, 2), 'utf8')
        this.registryMemory = registry
      } catch (error) {
        electronLogger.debug(
          '[resources] Background registry refresh failed: %s',
          error instanceof Error ? error.message : String(error),
        )
      } finally {
        this.registryRefreshPromise = null
      }
    })()
  }

  private async readManifest(): Promise<ResourceManifest> {
    try {
      return parseManifest(JSON.parse(await readFile(this.manifestPath, 'utf8')), this.resourcesDir, this.toolsDir, this.pdksDir)
    } catch {
      return this.emptyManifest()
    }
  }

  private async readRuntimeManifest(): Promise<ResourceManifest> {
    try {
      return parseManifest(JSON.parse(await readFile(this.manifestPath, 'utf8')), this.resourcesDir, this.toolsDir, this.pdksDir)
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        electronLogger.debug(
          '[resources] Failed to read runtime manifest: %s',
          error instanceof Error ? error.message : String(error),
        )
      }
      return this.emptyManifest()
    }
  }

  private async writeManifest(manifest: ResourceManifest): Promise<void> {
    manifest.resources_dir = this.resourcesDir
    manifest.tools_dir = this.toolsDir
    manifest.pdks_dir = this.pdksDir
    await mkdir(dirname(this.manifestPath), { recursive: true })
    const tempPath = `${this.manifestPath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tempPath, JSON.stringify(manifest, null, 2), 'utf8')
    await rename(tempPath, this.manifestPath)
  }

  private emptyManifest(): ResourceManifest {
    return {
      schema_version: 1,
      resources_dir: this.resourcesDir,
      tools_dir: this.toolsDir,
      pdks_dir: this.pdksDir,
      installed: {},
    }
  }

  private registryToolToResource(
    tool: RegistryTool,
    installed: Record<string, ToolInventoryEntry>,
  ): ResourceInfo {
    const versions = tool.versions.map((version) => version.version)
    const latest = tool.versions[0]
    const { platform, asset } = latest ? selectPlatformAsset(latest) : { platform: currentPlatform(), asset: null }
    const local = installed[tool.name]
    const resourceId = `tool:${tool.name}`
    let status: ResourceStatus = 'available'
    let actions: ResourceAction[] = ['install']

    if (this.activeJobs.has(resourceId)) {
      status = 'installing'
      actions = []
    } else if (local) {
      status = versions.length > 0 && versions[0] !== local.version ? 'update_available' : 'installed'
      actions = local.managed ? (status === 'update_available' ? ['update', 'uninstall'] : ['uninstall']) : []
    }

    return {
      id: resourceId,
      type: 'tool',
      name: tool.name,
      display_name: tool.display_name,
      description: tool.description,
      category: tool.category,
      status,
      installed_version: local?.version ?? null,
      available_versions: versions,
      active_version: local?.active ? local.version : null,
      active: local?.active ?? false,
      path: local?.path ?? null,
      managed_root: this.toolsDir,
      platform,
      size: asset?.size ?? null,
      source: 'registry',
      homepage: tool.homepage,
      actions,
      health: local ? toolHealth(local) : {},
      error: null,
    }
  }

  private installedToolToResource(name: string, entry: ToolInventoryEntry): ResourceInfo {
    const resourceId = `tool:${name}`
    return {
      id: resourceId,
      type: 'tool',
      name,
      display_name: name,
      description: '',
      category: '',
      status: this.activeJobs.has(resourceId) ? 'installing' : 'installed',
      installed_version: entry.version,
      available_versions: [],
      active_version: entry.active ? entry.version : null,
      active: entry.active,
      path: entry.path,
      managed_root: this.toolsDir,
      platform: null,
      size: null,
      source: 'local',
      homepage: '',
      actions: entry.managed ? ['uninstall'] : [],
      health: toolHealth(entry),
      error: null,
    }
  }

  private registryPdkToResource(pdk: RegistryPdk): ResourceInfo {
    const latest = pdk.versions[0]
    const { platform, asset } = latest ? selectPlatformAsset(latest) : { platform: currentPlatform(), asset: null }
    const resourceId = `pdk:${pdk.id}`
    const isActive = this.activeJobs.has(resourceId)
    return {
      id: resourceId,
      type: 'pdk',
      name: pdk.id,
      display_name: pdk.display_name,
      description: pdk.description ?? '',
      category: pdk.category ?? 'pdk',
      status: isActive ? 'installing' : 'available',
      installed_version: null,
      available_versions: pdk.versions.map((version) => version.version),
      active_version: null,
      active: false,
      path: null,
      managed_root: this.pdksDir,
      platform,
      size: asset?.size ?? null,
      source: 'registry',
      homepage: pdk.homepage ?? '',
      actions: isActive ? [] : ['install'],
      health: {},
      error: null,
    }
  }

  private pdkEntryToResource(entry: PdkInventoryEntry, registryPdk?: RegistryPdk): ResourceInfo {
    const resourceId = `pdk:${entry.id}`
    const hasUpdate = entry.managed
      && entry.health === 'ok'
      && Boolean(entry.version)
      && Boolean(registryPdk?.versions[0]?.version)
      && registryPdk?.versions[0]?.version !== entry.version
    const status: ResourceStatus = this.activeJobs.has(resourceId)
      ? 'installing'
      : entry.health === 'missing'
      ? 'missing'
      : entry.health === 'invalid'
        ? 'invalid'
        : hasUpdate
          ? 'update_available'
          : 'installed'
    const actions: ResourceAction[] = []
    if (status !== 'installing') {
      if (!entry.active) actions.push('activate')
      actions.push('validate')
      if (hasUpdate) actions.push('update')
      actions.push(entry.managed ? 'uninstall' : 'remove_reference')
    }

    return {
      id: resourceId,
      type: 'pdk',
      name: entry.id,
      display_name: entry.name || registryPdk?.display_name || entry.id,
      description: registryPdk?.description ?? '',
      category: registryPdk?.category ?? 'pdk',
      status,
      installed_version: entry.version || null,
      available_versions: registryPdk?.versions.map((version) => version.version) ?? [],
      active_version: entry.active ? entry.version || null : null,
      active: entry.active,
      path: entry.canonical_path,
      managed_root: entry.managed ? this.pdksDir : null,
      platform: null,
      size: null,
      source: entry.source || 'local',
      homepage: registryPdk?.homepage ?? '',
      actions,
      health: pdkHealth(entry),
      error: null,
    }
  }

  private findRegistryPdk(registry: ResourceRegistry | null, pdkId: string): RegistryPdk | undefined {
    return registry?.pdks.find((pdk) => pdk.id === pdkId)
  }

  private async withExtractProgress(
    resourceId: string,
    action: ResourceAction,
    name: string,
    listener: ((event: ResourceJob) => void) | undefined,
    task: () => Promise<void>,
  ): Promise<void> {
    let progress = 0.05
    let timer: NodeJS.Timeout | null = null
    const publishExtracting = (value: number): void => {
      progress = Math.max(progress, Math.min(value, 0.98))
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: 'extracting',
        progress,
        message: `Extracting ${name} ${Math.round(progress * 100)}%...`,
      })
    }

    publishExtracting(progress)
    timer = setInterval(() => {
      if (progress >= 0.95) return
      publishExtracting(progress + 0.03)
    }, 500)

    try {
      await task()
      publishExtracting(0.98)
    } finally {
      if (timer) clearInterval(timer)
    }
  }

  private publish(
    listener: ((event: ResourceJob) => void) | undefined,
    event: Omit<ResourceJob, 'id' | 'error'> & { error?: string | null },
  ): void {
    listener?.({
      id: randomUUID(),
      error: null,
      ...event,
    })
  }
}

function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
}

function xdgStateHome(): string {
  return process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state')
}

function xdgCacheHome(): string {
  return process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
}

function registryCachePath(cacheDir: string, registryUrl: string): string {
  if (registryUrl === DEFAULT_REGISTRY_URL) {
    return join(cacheDir, 'resource-registry.json')
  }
  const key = createHash('sha256').update(registryUrl).digest('hex').slice(0, 12)
  return join(cacheDir, `resource-registry-${key}.json`)
}

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function currentPlatform(): string {
  const machine = process.arch === 'x64' ? 'x86_64' : process.arch
  if (process.platform === 'linux') return `linux-${machine}`
  if (process.platform === 'darwin') return `darwin-${machine}`
  return `${process.platform}-${machine}`
}

function selectPlatformAsset(version: RegistryToolVersion | RegistryPdkVersion): {
  platform: string
  asset: PlatformAsset | null
} {
  const platform = currentPlatform()
  const asset = version.platforms[platform] ?? version.platforms[ALL_PLATFORM] ?? null
  return {
    platform: version.platforms[platform] ? platform : (asset ? ALL_PLATFORM : platform),
    asset,
  }
}

function parseRegistry(value: unknown): ResourceRegistry {
  const record = readRecord(value)
  if (record.schema_version !== 2) {
    throw new Error(`Unsupported registry schema version: ${String(record.schema_version)}`)
  }
  return {
    schema_version: 2,
    tools: Array.isArray(record.tools) ? record.tools.map(parseRegistryTool) : [],
    pdks: Array.isArray(record.pdks) ? record.pdks.map(parseRegistryPdk) : [],
  }
}

function parseRegistryTool(value: unknown): RegistryTool {
  const record = readRecord(value)
  return {
    name: readString(record.name),
    display_name: readString(record.display_name) || readString(record.name),
    description: readString(record.description),
    category: readString(record.category),
    homepage: readString(record.homepage),
    versions: Array.isArray(record.versions) ? record.versions.map(parseRegistryToolVersion) : [],
  }
}

function parseRegistryToolVersion(value: unknown): RegistryToolVersion {
  const record = readRecord(value)
  return {
    version: readString(record.version),
    platforms: parsePlatformAssets(record.platforms),
  }
}

function parseRegistryPdk(value: unknown): RegistryPdk {
  const record = readRecord(value)
  return {
    id: readString(record.id),
    display_name: readString(record.display_name) || readString(record.id),
    description: readString(record.description),
    category: readString(record.category) || 'pdk',
    homepage: readString(record.homepage),
    versions: Array.isArray(record.versions) ? record.versions.map(parseRegistryPdkVersion) : [],
  }
}

function parseRegistryPdkVersion(value: unknown): RegistryPdkVersion {
  const record = readRecord(value)
  return {
    version: readString(record.version),
    platforms: parsePlatformAssets(record.platforms),
  }
}

function parsePlatformAssets(value: unknown): Record<string, PlatformAsset> {
  const assets: Record<string, PlatformAsset> = {}
  for (const [platform, assetValue] of Object.entries(readRecord(value))) {
    const asset = readRecord(assetValue)
    assets[platform] = {
      url: readString(asset.url),
      sha256: readString(asset.sha256),
      size: readNumber(asset.size),
      strip_prefix: typeof asset.strip_prefix === 'string' ? asset.strip_prefix : null,
      post_install: parsePostInstallSteps(asset.post_install),
    }
  }
  return assets
}

function parsePostInstallSteps(value: unknown): RegistryPostInstallStep[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const record = readRecord(item)
      const command = readStringArray(record.command).filter(Boolean)
      if (command.length === 0) return null
      return {
        command,
        cwd: readString(record.cwd) || '.',
      }
    })
    .filter((step): step is RegistryPostInstallStep => step !== null)
}

function parseManifest(
  value: unknown,
  resourcesDir: string,
  toolsDir: string,
  pdksDir: string,
): ResourceManifest {
  const record = readRecord(value)
  const installed: Record<string, ResourceInventoryEntry> = {}
  for (const [resourceId, entry] of Object.entries(readRecord(record.installed))) {
    const parsed = parseInventoryEntry(entry)
    if (parsed) installed[resourceId] = parsed
  }
  return {
    schema_version: readNumber(record.schema_version) || 1,
    resources_dir: readString(record.resources_dir) || resourcesDir,
    tools_dir: readString(record.tools_dir) || toolsDir,
    pdks_dir: readString(record.pdks_dir) || pdksDir,
    installed,
  }
}

function parseInventoryEntry(value: unknown): ResourceInventoryEntry | null {
  const record = readRecord(value)
  if (record.type === 'tool') {
    return {
      type: 'tool',
      name: readString(record.name),
      version: readString(record.version),
      path: readString(record.path),
      installed_at: readString(record.installed_at),
      sha256: readString(record.sha256),
      detected_executables: readStringArray(record.detected_executables),
      executable: readString(record.executable),
      active: record.active !== false,
      managed: record.managed !== false,
    }
  }
  if (record.type === 'pdk') {
    const groups = readRecord(record.detected_file_groups)
    return {
      type: 'pdk',
      id: readString(record.id),
      name: readString(record.name),
      pdk_id: readString(record.pdk_id),
      version: readString(record.version),
      sha256: readString(record.sha256),
      source: readString(record.source),
      source_url: readString(record.source_url),
      canonical_path: readString(record.canonical_path),
      path: readString(record.path),
      detected_files: readStringArray(record.detected_files),
      detected_file_groups: {
        directories: readStringArray(groups.directories),
        files: readStringArray(groups.files),
      },
      imported_at: readString(record.imported_at),
      active: record.active === true,
      managed: record.managed === true,
      health: readString(record.health) || 'ok',
    }
  }
  return null
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

function pathKeyForRuntimeEnv(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
}

function runtimePathSeparator(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':'
}

function splitRuntimePath(value: string, platform: NodeJS.Platform): string[] {
  return value.split(runtimePathSeparator(platform)).filter(Boolean)
}

function mergeRuntimePath(
  basePath: string,
  resourceManagerDirs: string[],
  platform: NodeJS.Platform,
): string {
  const baseEntries = splitRuntimePath(basePath, platform)
  const packagedBin = baseEntries[0] && basename(baseEntries[0]).toLowerCase() === 'binaries'
    ? baseEntries[0]
    : null
  const orderedEntries = [
    ...(packagedBin ? [packagedBin] : []),
    ...resourceManagerDirs,
    ...baseEntries.filter((entry) => entry !== packagedBin),
  ]
  const seen = new Set<string>()
  return orderedEntries
    .filter((entry) => {
      if (seen.has(entry)) return false
      seen.add(entry)
      return true
    })
    .join(runtimePathSeparator(platform))
}

async function isUsableExecutable(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function isExistingDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function readRegistryFromUrl(url: string, fetchImpl: typeof fetch): Promise<ResourceRegistry> {
  if (url.startsWith('file://')) {
    return parseRegistry(JSON.parse(await readFile(new URL(url), 'utf8')))
  }
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`Registry request failed with ${response.status}: ${url}`)
  }
  return parseRegistry(await response.json())
}

function getInstalledTools(manifest: ResourceManifest): Record<string, ToolInventoryEntry> {
  const entries: Record<string, ToolInventoryEntry> = {}
  for (const [resourceId, entry] of Object.entries(manifest.installed)) {
    if (isToolEntry(entry)) entries[resourceId.replace(/^tool:/, '')] = entry
  }
  return entries
}

function getInstalledPdks(manifest: ResourceManifest): Record<string, PdkInventoryEntry> {
  const entries: Record<string, PdkInventoryEntry> = {}
  for (const [resourceId, entry] of Object.entries(manifest.installed)) {
    if (isPdkEntry(entry)) entries[resourceId.replace(/^pdk:/, '')] = entry
  }
  return entries
}

function isToolEntry(entry: unknown): entry is ToolInventoryEntry {
  return readRecord(entry).type === 'tool'
}

function isPdkEntry(entry: unknown): entry is PdkInventoryEntry {
  return readRecord(entry).type === 'pdk'
}

function resourceNameFromId(resourceId: string, prefix: 'tool' | 'pdk'): string {
  const expectedPrefix = `${prefix}:`
  if (!resourceId.startsWith(expectedPrefix)) {
    throw new Error(`Expected ${prefix} resource id, got ${resourceId}`)
  }
  return resourceId.slice(expectedPrefix.length)
}

function toolHealth(entry: ToolInventoryEntry): Record<string, unknown> {
  return {
    detected_executables: entry.detected_executables,
    installed_at: entry.installed_at,
    managed: entry.managed,
    sha256: entry.sha256,
    executable: entry.executable,
  }
}

function pdkHealth(entry: PdkInventoryEntry): Record<string, unknown> {
  return {
    status: entry.health,
    detected_files: entry.detected_file_groups,
    detected_file_list: entry.detected_files,
    detected_file_groups: entry.detected_file_groups,
    imported_at: entry.imported_at,
    managed: entry.managed,
    version: entry.version,
    sha256: entry.sha256,
    source: entry.source,
    source_url: entry.source_url,
  }
}

async function scanPdkDirectory(path: string): Promise<{
  canonicalPath: string
  name: string
  description: string
  techNode: string
  pdkId: string
  detectedFiles: { directories: string[]; files: string[] }
}> {
  const canonicalPath = resolve(path)
  const pathStats = await stat(canonicalPath)
  if (!pathStats.isDirectory()) {
    throw new Error(`Not a directory: ${path}`)
  }
  const entries = await readdir(canonicalPath, { withFileTypes: true })
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().slice(0, TOP_LEVEL_ENTRY_LIMIT)
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort().slice(0, TOP_LEVEL_ENTRY_LIMIT)
  let name = canonicalPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'Unknown PDK'
  let description = ''
  let techNode = ''
  let pdkId = name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

  if (directories.includes('prtech') && directories.includes('IP')) {
    name = 'ics55'
    description = 'ICSPROUT 55nm process library (auto-detected)'
    techNode = '55nm'
    pdkId = 'ics55'
  } else if (directories.some((directory) => directory.startsWith('sky130'))) {
    name = 'SkyWater SKY130 PDK'
    description = 'SkyWater 130nm open-source PDK (auto-detected)'
    techNode = '130nm'
    pdkId = 'sky130'
  } else if (files.some((file) => file.endsWith('.lef') || file.endsWith('.lib'))) {
    description = 'Process library files detected'
  }

  return {
    canonicalPath,
    name,
    description,
    techNode,
    pdkId,
    detectedFiles: { directories, files },
  }
}

function readContentLength(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${bytes} B`
}

async function downloadAsset(
  url: string,
  destination: string,
  fetchImpl: typeof fetch,
  expectedSize: number | null,
  onProgress?: DownloadProgressListener,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)
  if (url.startsWith('file://')) {
    const fileUrl = new URL(url)
    await copyFile(fileUrl, destination)
    const size = await stat(fileUrl).then((value) => value.size).catch(() => 0)
    onProgress?.({
      downloadedBytes: size,
      progress: 1,
      totalBytes: size > 0 ? size : null,
    })
    return
  }
  let response: Response
  try {
    response = await fetchImpl(url, { signal })
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error
    throw new Error(`Failed to download ${url}: ${formatDownloadError(error)}`, { cause: error })
  }
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}: ${url}`)
  }

  const totalBytes = readContentLength(response.headers.get('content-length'))
    ?? (expectedSize && expectedSize > 0 ? expectedSize : null)
  if (!response.body) {
    const data = Buffer.from(await response.arrayBuffer())
    await writeFile(destination, data)
    onProgress?.({
      downloadedBytes: data.byteLength,
      progress: 1,
      totalBytes: totalBytes ?? data.byteLength,
    })
    return
  }

  const reader = response.body.getReader()
  const file = await open(destination, 'w')
  let downloadedBytes = 0
  let lastPublishedBytes = 0
  let lastPublishedProgress = 0

  const publishProgress = (force = false): void => {
    const progress = totalBytes === null
      ? 0
      : Math.min(downloadedBytes / totalBytes, 1)
    const shouldPublishKnownTotal = totalBytes !== null
      && (progress - lastPublishedProgress >= 0.01 || progress >= 1)
    const shouldPublishUnknownTotal = totalBytes === null
      && downloadedBytes - lastPublishedBytes >= 1024 * 1024
    if (!force && !shouldPublishKnownTotal && !shouldPublishUnknownTotal) return
    if (downloadedBytes === lastPublishedBytes && progress === lastPublishedProgress) return
    lastPublishedBytes = downloadedBytes
    lastPublishedProgress = progress
    onProgress?.({
      downloadedBytes,
      progress,
      totalBytes,
    })
  }

  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      await file.write(value)
      downloadedBytes += value.byteLength
      publishProgress()
    }
    publishProgress(true)
  } finally {
    reader.releaseLock()
    await file.close()
  }
}

function formatDownloadError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const cause = error.cause
  if (cause instanceof Error) {
    const code = typeof (cause as NodeJS.ErrnoException).code === 'string'
      ? `${(cause as NodeJS.ErrnoException).code}: `
      : ''
    return `${error.message} (${code}${cause.message})`
  }

  return error.message
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new DOMException('The operation was aborted.', 'AbortError')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readPdkReleaseAssetNames(destination: string): Promise<string[]> {
  const makefilePath = join(destination, 'Makefile')
  const makefile = await readFile(makefilePath, 'utf8').catch(() => '')
  if (!makefile) return []
  return parseMakefileReleaseAssetNames(makefile)
}

function parseMakefileReleaseAssetNames(makefile: string): string[] {
  const variables = new Map<string, string[]>()
  const assignmentPattern = /^([A-Za-z0-9_]+)\s*(?::=|=)\s*(.*)$/
  const lines = makefile.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].replace(/#.*$/, '').trimEnd()
    if (!assignmentPattern.test(line.trimStart())) continue
    while (line.endsWith('\\') && index + 1 < lines.length) {
      line = `${line.slice(0, -1)} ${lines[index + 1].replace(/#.*$/, '').trim()}`
      index += 1
    }
    const match = line.trim().match(assignmentPattern)
    if (!match) continue
    const [, name, rawValue] = match
    variables.set(name, expandMakefileWords(rawValue, variables))
  }

  const releaseFiles = variables.get('RELEASE_FILE')
    ?? Array.from(variables.entries())
      .filter(([name]) => name.startsWith('RELEASE_FILE'))
      .flatMap(([, value]) => value)
  return Array.from(new Set(releaseFiles.filter(isDownloadableReleaseAssetName)))
}

function expandMakefileWords(rawValue: string, variables: Map<string, string[]>): string[] {
  const words: string[] = []
  for (const token of rawValue.split(/\s+/).filter(Boolean)) {
    const variableMatch = token.match(/^\$\(([^)]+)\)$/)
    if (variableMatch) {
      words.push(...(variables.get(variableMatch[1]) ?? []))
      continue
    }
    words.push(token)
  }
  return words
}

function isDownloadableReleaseAssetName(name: string): boolean {
  return /^[A-Za-z0-9._+-]+\.tar\.bz2$/.test(name)
}

function releaseDownloadBaseUrl(sourceUrl: string, version: string): string | null {
  const parsed = parseGithubArchiveUrl(sourceUrl)
  if (!parsed) return null
  return `https://github.com/${parsed.owner}/${parsed.repo}/releases/download/${parsed.tag || `v${version}`}`
}

function parseGithubArchiveUrl(sourceUrl: string): { owner: string; repo: string; tag: string | null } | null {
  let url: URL
  try {
    url = new URL(sourceUrl)
  } catch {
    return null
  }
  if (url.hostname !== 'github.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const [owner, repo] = parts
  const refsIndex = parts.findIndex((part, index) => part === 'refs' && parts[index + 1] === 'tags')
  const tag = refsIndex >= 0 ? parts[refsIndex + 2]?.replace(/\.tar\.gz$|\.zip$/, '') ?? null : null
  return { owner, repo, tag }
}

async function verifySha256(filePath: string, expected: string): Promise<boolean> {
  if (!expected) return true
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolvePromise())
  })
  return hash.digest('hex') === expected.toLowerCase()
}

async function extractZipArchive(
  archivePath: string,
  destination: string,
  stripPrefix?: string | null,
): Promise<void> {
  if (!stripPrefix) {
    await runCommand('unzip', ['-q', archivePath, '-d', destination])
    return
  }
  const tempDestination = `${destination}.zip-${randomUUID()}`
  await mkdir(tempDestination, { recursive: true })
  try {
    await runCommand('unzip', ['-q', archivePath, '-d', tempDestination])
    await moveStrippedPrefix(tempDestination, destination, stripPrefix)
  } finally {
    await rm(tempDestination, { force: true, recursive: true })
  }
}

async function extractArchive(
  archivePath: string,
  destination: string,
  stripPrefix?: string | null,
): Promise<void> {
  await mkdir(destination, { recursive: true })
  if (archivePath.endsWith('.zip')) {
    await extractZipArchive(archivePath, destination, stripPrefix)
    return
  }
  const args = ['-xf', archivePath, '-C', destination]
  if (stripPrefix) {
    args.push('--strip-components', '1')
  }
  await runCommand('tar', args)
}

async function moveStrippedPrefix(sourceRoot: string, destination: string, stripPrefix: string): Promise<void> {
  const source = resolveInside(sourceRoot, stripPrefix)
  const sourceStats = await stat(source)
  if (!sourceStats.isDirectory()) {
    throw new Error(`Archive strip_prefix is not a directory: ${stripPrefix}`)
  }
  await rm(destination, { force: true, recursive: true })
  await mkdir(dirname(destination), { recursive: true })
  await rename(source, destination)
}

function resolveInside(root: string, child: string): string {
  const resolved = resolve(root, child || '.')
  const relativePath = relative(root, resolved)
  if (isAbsolute(relativePath) || relativePath.startsWith('..')) {
    throw new Error(`Path escapes resource directory: ${child}`)
  }
  return resolved
}

async function runCommand(command: string, args: string[], options?: CommandRunnerOptions): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options?.cwd, stdio: 'pipe' })
    let stderr = ''
    child.stdout?.on('data', () => {
      // Consume noisy command output so verbose tools cannot block on pipe backpressure.
    })
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)}`
      if (stderr.length > COMMAND_ERROR_OUTPUT_LIMIT) {
        stderr = stderr.slice(-COMMAND_ERROR_OUTPUT_LIMIT)
      }
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        const details = stderr.trim()
        reject(new Error(`${command} failed with exit code ${code}${details ? `: ${details}` : ''}`))
      }
    })
  })
}

async function detectExecutables(root: string): Promise<string[]> {
  const results: string[] = []
  await collectExecutableFiles(root, root, results)
  return results.sort()
}

async function collectExecutableFiles(root: string, directory: string, results: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => null)
  if (!entries) return

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectExecutableFiles(root, path, results)
    } else if (entry.isFile()) {
      try {
        await access(path, 0o111)
        results.push(path.slice(root.length + 1).replace(/\\/g, '/'))
      } catch {
        // Non-executable files are ignored.
      }
    }
  }
}
