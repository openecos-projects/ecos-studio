import { spawn as spawnChild, type SpawnOptions } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  DESKTOP_CODEX_BIN_SETTING_KEY,
  DESKTOP_CODEX_MODEL_SOURCE_SETTING_KEY,
  DESKTOP_GLM_API_KEY_SETTING_KEY,
  type DesktopCodexAuthState,
  type DesktopCodexDependencyStatus,
  type DesktopCodexInstallProgressEvent,
  type DesktopCodexModelSource,
  type DesktopSettingsValue,
} from '@ecos-studio/shared'
import { writeGlmConfigHome } from './glmConfigHome'

type SpawnLike = typeof spawnChild
type FetchLike = typeof fetch

export interface CodexDependencySettingsStore {
  get<T extends DesktopSettingsValue = DesktopSettingsValue>(
    key: string,
  ): Promise<T | null>
  set(key: string, value: DesktopSettingsValue): Promise<void>
}

export interface CodexDependencyServiceOptions {
  env?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  installRoot?: string
  glmConfigRoot?: string
  platform?: NodeJS.Platform
  arch?: string
  settingsStore: CodexDependencySettingsStore
  spawn?: SpawnLike
  homedir?: () => string
}

const GITHUB_LATEST_DOWNLOAD_BASE =
  'https://github.com/openai/codex/releases/latest/download'
const OPENAI_RELEASES_BASE = 'https://releases.openai.com/codex'

export class CodexDependencyService {
  private readonly env: NodeJS.ProcessEnv
  private readonly fetchImpl: FetchLike
  private readonly installRoot: string
  private readonly glmConfigRoot: string
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly settingsStore: CodexDependencySettingsStore
  private readonly spawnImpl: SpawnLike
  private readonly resolveHomedir: () => string
  private installPromise: Promise<DesktopCodexDependencyStatus> | null = null
  private glmHomeWritePromise: Promise<void> | null = null
  private progressListeners = new Set<(event: DesktopCodexInstallProgressEvent) => void>()
  private lastProgress: DesktopCodexInstallProgressEvent | null = null

  constructor(options: CodexDependencyServiceOptions) {
    this.env = options.env ?? process.env
    this.fetchImpl = options.fetchImpl ?? fetch
    this.installRoot =
      options.installRoot ??
      join(homedir(), '.local', 'share', 'ecos-studio', 'codex-cli')
    this.glmConfigRoot =
      options.glmConfigRoot ??
      join(homedir(), '.local', 'share', 'ecos-studio', 'codex-glm')
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.settingsStore = options.settingsStore
    this.spawnImpl = options.spawn ?? spawnChild
    this.resolveHomedir = options.homedir ?? homedir
  }

  onProgress(listener: (event: DesktopCodexInstallProgressEvent) => void): () => void {
    this.progressListeners.add(listener)
    if (this.lastProgress) listener(this.lastProgress)
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  platformSupportsInstall(): boolean {
    return this.platform === 'linux' && (this.arch === 'x64' || this.arch === 'arm64')
  }

  async getStatus(): Promise<DesktopCodexDependencyStatus> {
    if (this.installPromise) {
      return {
        authState: 'unknown',
        message: this.lastProgress?.message ?? '正在安装 Codex CLI…',
        platformSupportsInstall: this.platformSupportsInstall(),
        progressMessage: this.lastProgress?.message,
        progressRatio: this.lastProgress?.progress,
        state: 'installing',
      }
    }
    return await this.probeStatus()
  }

  private async probeStatus(): Promise<DesktopCodexDependencyStatus> {
    const modelSource = await this.readModelSource()
    const resolved = await this.resolveBinPath()
    if (!resolved) {
      return {
        authState: 'unknown',
        message: this.platformSupportsInstall()
          ? '未检测到 Codex CLI。可一键安装到 Studio 托管目录，或选择本机已有二进制。'
          : '未检测到 Codex CLI。请先安装 Codex CLI，再选择本机二进制路径。',
        modelSource,
        platformSupportsInstall: this.platformSupportsInstall(),
        state: 'missing',
      }
    }

    const version = await this.readVersion(resolved)
    if (!version) {
      return {
        authState: 'unknown',
        binPath: resolved,
        message: '已找到 Codex 路径，但无法执行。请重新安装或选择其他二进制。',
        modelSource,
        platformSupportsInstall: this.platformSupportsInstall(),
        state: 'error',
      }
    }

    if (modelSource === 'glm') {
      const apiKey = await this.readGlmApiKey()
      const authState: DesktopCodexAuthState = apiKey
        ? 'authenticated'
        : 'unauthenticated'
      return {
        authState,
        binPath: resolved,
        message: apiKey
          ? 'GLM API Key 已配置，Codex CLI 已就绪。'
          : '已选择 GLM 模型来源。请填入智谱 API Key 后使用 Agent。',
        modelSource,
        platformSupportsInstall: this.platformSupportsInstall(),
        state: authState === 'authenticated' ? 'ready' : 'installed_needs_login',
        version,
      }
    }

    const authState = await this.detectAuthState(resolved)
    if (authState === 'unauthenticated') {
      return {
        authState,
        binPath: resolved,
        message: 'Codex CLI 已就绪，但尚未登录。请完成登录后再使用 Agent。',
        modelSource,
        platformSupportsInstall: this.platformSupportsInstall(),
        state: 'installed_needs_login',
        version,
      }
    }

    return {
      authState,
      binPath: resolved,
      message:
        authState === 'unknown'
          ? '已找到 Codex CLI。若 Agent 仍提示需要登录，请点击“打开登录”。'
          : 'Codex CLI 已就绪。',
      modelSource,
      platformSupportsInstall: this.platformSupportsInstall(),
      state: 'ready',
      version,
    }
  }

  async recheck(): Promise<DesktopCodexDependencyStatus> {
    return await this.getStatus()
  }

  async setBinPath(pathValue: string): Promise<DesktopCodexDependencyStatus> {
    const trimmed = pathValue.trim()
    if (!trimmed) {
      throw new Error('Codex 路径不能为空')
    }
    const resolved = await this.validateExecutable(
      expandUserPath(trimmed, this.resolveHomedir),
    )
    if (!resolved) {
      throw new Error('所选路径不是可执行的 Codex CLI')
    }
    await this.settingsStore.set(DESKTOP_CODEX_BIN_SETTING_KEY, resolved)
    return await this.getStatus()
  }

  async setModelSource(
    source: DesktopCodexModelSource,
  ): Promise<DesktopCodexDependencyStatus> {
    if (source === 'glm') {
      await this.ensureGlmConfigHome()
    }
    await this.settingsStore.set(DESKTOP_CODEX_MODEL_SOURCE_SETTING_KEY, source)
    return await this.getStatus()
  }

  async setGlmApiKey(apiKey: string): Promise<DesktopCodexDependencyStatus> {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      throw new Error('GLM API Key 不能为空')
    }
    await this.ensureGlmConfigHome()
    // Saving a key implies the GLM source — this is the “保存并使用 GLM” action.
    await this.settingsStore.set(DESKTOP_CODEX_MODEL_SOURCE_SETTING_KEY, 'glm')
    await this.settingsStore.set(DESKTOP_GLM_API_KEY_SETTING_KEY, trimmed)
    return await this.getStatus()
  }

  private async readModelSource(): Promise<DesktopCodexModelSource> {
    const stored = await this.settingsStore.get<string>(
      DESKTOP_CODEX_MODEL_SOURCE_SETTING_KEY,
    )
    return stored === 'glm' ? 'glm' : 'codex'
  }

  private async readGlmApiKey(): Promise<string | null> {
    const stored = await this.settingsStore.get<string>(DESKTOP_GLM_API_KEY_SETTING_KEY)
    return typeof stored === 'string' && stored.trim() ? stored.trim() : null
  }

  private async ensureGlmConfigHome(): Promise<void> {
    this.glmHomeWritePromise ??= writeGlmConfigHome(this.glmConfigRoot).finally(() => {
      this.glmHomeWritePromise = null
    })
    await this.glmHomeWritePromise
  }

  async install(): Promise<DesktopCodexDependencyStatus> {
    if (!this.platformSupportsInstall()) {
      throw new Error('当前平台暂不支持一键安装 Codex CLI')
    }
    if (this.installPromise) {
      return await this.installPromise
    }
    this.installPromise = this.runInstall().finally(() => {
      this.installPromise = null
    })
    return await this.installPromise
  }

  async login(): Promise<DesktopCodexDependencyStatus> {
    if ((await this.readModelSource()) === 'glm') {
      // GLM authenticates with an API key, not a ChatGPT login.
      return await this.getStatus()
    }
    const bin = await this.resolveBinPath()
    if (!bin) {
      throw new Error('请先安装或选择 Codex CLI')
    }
    await this.runCommand(bin, ['login'], {
      env: this.commandEnv(bin),
      stdio: 'ignore',
      detached: true,
    }).catch(() => {
      // Browser login may keep the process attached; launching is best-effort.
    })
    // Detached spawn returns immediately; give auth files a brief chance to appear
    // only if the user already completed login in another session.
    return await this.getStatus()
  }

  async resolveEnvironmentForAgent(): Promise<Record<string, string | undefined>> {
    const binPath = await this.resolveBinPath()
    if (!binPath) return {}
    if ((await this.readModelSource()) === 'glm') {
      // GLM mode: point codex at the managed config home and pass the API key
      // through the environment only — it is never written to the config dir.
      return {
        ECOS_AGENT_CODEX_BIN: binPath,
        CODEX_HOME: this.glmConfigRoot,
        ZAI_API_KEY: (await this.readGlmApiKey()) ?? undefined,
        PATH: prependPath(dirname(binPath), this.env.PATH),
      }
    }
    // Codex mode: clear stale GLM overrides so switching sources is clean.
    return {
      ECOS_AGENT_CODEX_BIN: binPath,
      CODEX_HOME: undefined,
      ZAI_API_KEY: undefined,
      PATH: prependPath(dirname(binPath), this.env.PATH),
    }
  }

  private async runInstall(): Promise<DesktopCodexDependencyStatus> {
    const assetName = linuxAssetName(this.arch)
    if (!assetName) {
      throw new Error(`不支持的 Linux 架构: ${this.arch}`)
    }

    const downloadsDir = join(this.installRoot, 'downloads')
    const binDir = join(this.installRoot, 'bin')
    const archivePath = join(downloadsDir, assetName)
    const targetBin = join(binDir, 'codex')

    await mkdir(downloadsDir, { recursive: true })
    await mkdir(binDir, { recursive: true })

    this.emitProgress({
      phase: 'downloading',
      message: '正在下载 Codex CLI…',
      progress: 0,
    })

    try {
      await this.downloadCodexArchive(assetName, archivePath, (progress) => {
        this.emitProgress({
          phase: 'downloading',
          message: `正在下载 Codex CLI… ${Math.round(progress * 100)}%`,
          progress,
        })
      })
    } catch (error) {
      this.emitProgress({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }

    this.emitProgress({
      phase: 'extracting',
      message: '正在解压 Codex CLI…',
      progress: 0.9,
    })

    const extractDir = await mkdtemp(join(tmpdir(), 'ecos-codex-'))
    try {
      await this.runTarExtract(archivePath, extractDir)
      const extractedBinary = await findExtractedCodexBinary(extractDir)
      if (!extractedBinary) {
        throw new Error('压缩包中未找到 Codex 可执行文件')
      }
      await mkdir(dirname(targetBin), { recursive: true })
      await rm(targetBin, { force: true })
      await copyFile(extractedBinary, targetBin)
      await chmod(targetBin, 0o755)
    } finally {
      await rm(extractDir, { force: true, recursive: true })
    }

    this.emitProgress({
      phase: 'verifying',
      message: '正在验证 Codex CLI…',
      progress: 0.97,
    })

    const version = await this.readVersion(targetBin)
    if (!version) {
      const error = new Error('安装完成但 Codex CLI 无法执行')
      this.emitProgress({ phase: 'error', message: error.message })
      throw error
    }

    await this.settingsStore.set(DESKTOP_CODEX_BIN_SETTING_KEY, targetBin)
    this.emitProgress({
      phase: 'done',
      message: `Codex CLI ${version} 已安装`,
      progress: 1,
    })
    // Avoid getStatus()'s in-flight install short-circuit while installPromise is set.
    return await this.probeStatus()
  }

  private async downloadCodexArchive(
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
        await downloadToFile(url, destination, this.fetchImpl, onProgress)
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

  private async resolveBinPath(): Promise<string | null> {
    const fromSettings = await this.settingsStore.get<string>(
      DESKTOP_CODEX_BIN_SETTING_KEY,
    )
    if (typeof fromSettings === 'string' && fromSettings.trim()) {
      const validated = await this.validateExecutable(
        expandUserPath(fromSettings.trim(), this.resolveHomedir),
      )
      if (validated) return validated
    }

    const fromEnv = this.env.ECOS_AGENT_CODEX_BIN
    if (typeof fromEnv === 'string' && fromEnv.trim()) {
      const validated = await this.validateExecutable(
        expandUserPath(fromEnv.trim(), this.resolveHomedir),
      )
      if (validated) return validated
    }

    const managed = join(this.installRoot, 'bin', 'codex')
    const managedValidated = await this.validateExecutable(managed)
    if (managedValidated) return managedValidated

    return await this.whichCodex()
  }

  private async whichCodex(): Promise<string | null> {
    const pathValue = this.env.PATH ?? ''
    for (const entry of pathValue.split(':')) {
      if (!entry) continue
      const candidate = join(entry, 'codex')
      const validated = await this.validateExecutable(candidate)
      if (validated) return validated
    }
    return null
  }

  private async validateExecutable(pathValue: string): Promise<string | null> {
    try {
      await access(pathValue)
      const info = await stat(pathValue)
      if (!info.isFile()) return null
      // Best-effort execute bit check; still verify with --version later.
      if ((info.mode & 0o111) === 0) return null
      return pathValue
    } catch {
      return null
    }
  }

  private async readVersion(bin: string): Promise<string | null> {
    try {
      const { stdout } = await this.runCommandCapture(bin, ['--version'], {
        env: this.commandEnv(bin),
        timeoutMs: 8_000,
      })
      const line = stdout.trim().split(/\r?\n/)[0]?.trim()
      return line || null
    } catch {
      return null
    }
  }

  private async detectAuthState(bin: string): Promise<DesktopCodexAuthState> {
    try {
      const { stdout, stderr } = await this.runCommandCapture(bin, ['login', 'status'], {
        env: this.commandEnv(bin),
        timeoutMs: 8_000,
      })
      const text = `${stdout}\n${stderr}`.toLowerCase()
      if (/not logged|unauthenticated|signed out|no .*auth|login required/.test(text)) {
        return 'unauthenticated'
      }
      if (/logged in|authenticated|signed in|active.*session|auth.*ok/.test(text)) {
        return 'authenticated'
      }
    } catch {
      // Fall through to auth file probe.
    }

    const authPath = join(this.resolveHomedir(), '.codex', 'auth.json')
    try {
      await access(authPath)
      const info = await stat(authPath)
      if (info.isFile() && info.size > 2) return 'authenticated'
    } catch {
      // ignore
    }
    return 'unknown'
  }

  private emitProgress(event: DesktopCodexInstallProgressEvent): void {
    this.lastProgress = event
    for (const listener of this.progressListeners) {
      listener(event)
    }
  }

  private commandEnv(bin: string): NodeJS.ProcessEnv {
    return { ...this.env, PATH: prependPath(dirname(bin), this.env.PATH) }
  }

  private async runTarExtract(archivePath: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const child = this.spawnImpl('tar', ['-xf', archivePath, '-C', destination], {
        stdio: 'pipe',
      })
      let stderr = ''
      child.stderr?.on('data', (chunk) => {
        stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar failed: ${stderr.trim() || `exit ${code}`}`))
      })
    })
  }

  private runCommand(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(command, args, {
        ...options,
        env: options.env ?? this.env,
      })
      child.on('error', reject)
      if (options.detached) {
        child.unref()
        resolve()
        return
      }
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`))
      })
    })
  }

  private runCommandCapture(
    command: string,
    args: string[],
    options: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(command, args, {
        env: options.env ?? this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      const timer =
        options.timeoutMs && options.timeoutMs > 0
          ? setTimeout(() => {
              child.kill()
              reject(new Error(`${command} timed out`))
            }, options.timeoutMs)
          : null
      child.stdout?.on('data', (chunk) => {
        stdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      })
      child.on('error', (error) => {
        if (timer) clearTimeout(timer)
        reject(error)
      })
      child.on('close', (code) => {
        if (timer) clearTimeout(timer)
        resolve({ code, stdout, stderr })
      })
    })
  }
}

function linuxAssetName(arch: string): string | null {
  if (arch === 'x64') return 'codex-x86_64-unknown-linux-musl.tar.gz'
  if (arch === 'arm64') return 'codex-aarch64-unknown-linux-musl.tar.gz'
  return null
}

function expandUserPath(pathValue: string, resolveHome: () => string): string {
  if (pathValue === '~') return resolveHome()
  if (pathValue.startsWith('~/') || pathValue.startsWith('~\\')) {
    return join(resolveHome(), pathValue.slice(2))
  }
  return pathValue
}

function prependPath(directory: string, pathValue: string | undefined): string {
  const entries =
    pathValue?.split(delimiter).filter((entry) => entry && entry !== directory) ?? []
  return [directory, ...entries].join(delimiter)
}

async function downloadToFile(
  url: string,
  destination: string,
  fetchImpl: FetchLike,
  onProgress: (progress: number) => void,
): Promise<void> {
  const response = await fetchImpl(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}: ${url}`)
  }
  await mkdir(dirname(destination), { recursive: true })
  const totalHeader = response.headers.get('content-length')
  const totalBytes = totalHeader ? Number(totalHeader) : NaN
  if (!response.body) {
    const data = Buffer.from(await response.arrayBuffer())
    await writeFile(destination, data)
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
    if (Number.isFinite(totalBytes) && totalBytes > 0) {
      onProgress(Math.min(downloaded / totalBytes, 0.99))
    }
  })
  await pipeline(nodeStream, file)
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
