import { access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { spawn as spawnChild, type SpawnOptions } from 'node:child_process'
import { captureCommandOutput } from '../commandCapture'
import {
  installManagedCodex,
  linuxAssetName,
  type FetchLike,
  type SpawnLike,
} from './codexManagedInstaller'
import {
  DESKTOP_CODEX_BIN_SETTING_KEY,
  type DesktopCodexAuthState,
  type DesktopCodexDependencyStatus,
  type DesktopCodexInstallProgressEvent,
  type DesktopSettingsValue,
} from '@ecos-studio/shared'

export interface CodexDependencySettingsStore {
  delete(key: string): Promise<void>
  get<T extends DesktopSettingsValue = DesktopSettingsValue>(
    key: string,
  ): Promise<T | null>
  set(key: string, value: DesktopSettingsValue): Promise<void>
}

export interface CodexDependencyServiceOptions {
  env?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  installRoot?: string
  platform?: NodeJS.Platform
  arch?: string
  settingsStore: CodexDependencySettingsStore
  spawn?: SpawnLike
  homedir?: () => string
}
export class CodexDependencyService {
  private readonly env: NodeJS.ProcessEnv
  private readonly fetchImpl: FetchLike
  private readonly installRoot: string
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly settingsStore: CodexDependencySettingsStore
  private readonly spawnImpl: SpawnLike
  private readonly resolveHomedir: () => string
  private installPromise: Promise<DesktopCodexDependencyStatus> | null = null
  private progressListeners = new Set<(event: DesktopCodexInstallProgressEvent) => void>()
  private lastProgress: DesktopCodexInstallProgressEvent | null = null
  /**
   * Optional persistence hook for the managed install write. Electron main
   * routes it through the settings-registry key transaction so the install
   * write cannot interleave with registry writes of the same key.
   */
  private managedBinPersister:
    | ((binPath: string, baselineValue: string | null) => Promise<void>)
    | null = null

  constructor(options: CodexDependencyServiceOptions) {
    this.env = options.env ?? process.env
    this.fetchImpl = options.fetchImpl ?? fetch
    this.installRoot =
      options.installRoot ??
      join(homedir(), '.local', 'share', 'ecos-studio', 'codex-cli')
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.settingsStore = options.settingsStore
    this.spawnImpl = options.spawn ?? spawnChild
    this.resolveHomedir = options.homedir ?? homedir
  }

  onProgress(listener: (event: DesktopCodexInstallProgressEvent) => void): () => void {
    this.progressListeners.add(listener)
    if (this.lastProgress) {
      // The immediate replay must not fail the subscription when a listener
      // throws (for example a renderer that died mid-notification).
      try {
        listener(this.lastProgress)
      } catch {
        // ignore
      }
    }
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  setManagedBinPersister(
    persist: ((binPath: string, baselineValue: string | null) => Promise<void>) | null,
  ): void {
    this.managedBinPersister = persist
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
    const resolved = await this.resolveBinPath()
    if (!resolved) {
      return {
        authState: 'unknown',
        message: this.platformSupportsInstall()
          ? '未检测到 Codex CLI。可一键安装到 Studio 托管目录，或选择本机已有二进制。'
          : '未检测到 Codex CLI。请先安装 Codex CLI，再选择本机二进制路径。',
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
        platformSupportsInstall: this.platformSupportsInstall(),
        state: 'error',
      }
    }
    // A legacy or environment-provided path pointing at an unrelated binary is
    // degraded to an error state so the agent never runs it as Codex.
    if (!/^codex[\s_-]/i.test(version)) {
      return {
        authState: 'unknown',
        binPath: resolved,
        message: '该路径不是有效的 Codex CLI。请重新选择 Codex 二进制。',
        platformSupportsInstall: this.platformSupportsInstall(),
        state: 'error',
      }
    }

    const authState = await this.detectAuthState(resolved)
    if (authState === 'unauthenticated') {
      return {
        authState,
        binPath: resolved,
        message: 'Codex CLI 已就绪，但尚未登录。请完成登录后再使用 Agent。',
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
    // Canonicalize (tilde expansion + working-directory resolution) so the
    // stored value is spawnable as-is regardless of the entry point.
    const resolved = resolve(expandUserPath(trimmed, this.resolveHomedir))
    if (!(await this.validateExecutable(resolved))) {
      throw new Error('所选路径不是可执行的 Codex CLI')
    }
    // A non-Codex binary (for example /bin/true) must never be persisted; the
    // version line has to start with a Codex marker.
    const version = await this.readVersion(resolved)
    if (!version || !/^codex[\s_-]/i.test(version)) {
      throw new Error('所选路径不是可执行的 Codex CLI')
    }
    await this.settingsStore.set(DESKTOP_CODEX_BIN_SETTING_KEY, resolved)
    return await this.getStatus()
  }

  /**
   * Remove the persisted Codex binary override so resolution falls back to the
   * environment, the managed install, or PATH.
   */
  async clearBinPath(): Promise<DesktopCodexDependencyStatus> {
    await this.settingsStore.delete(DESKTOP_CODEX_BIN_SETTING_KEY)
    return await this.getStatus()
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
    return {
      ECOS_AGENT_CODEX_BIN: binPath ?? undefined,
      PATH: binPath ? prependPath(dirname(binPath), this.env.PATH) : undefined,
    }
  }

  private async runInstall(): Promise<DesktopCodexDependencyStatus> {
    const assetName = linuxAssetName(this.arch)
    if (!assetName) {
      throw new Error(`不支持的 Linux 架构: ${this.arch}`)
    }

    const status = await installManagedCodex({
      arch: this.arch,
      installRoot: this.installRoot,
      env: this.env,
      fetchImpl: this.fetchImpl,
      spawnImpl: this.spawnImpl,
      valueAtStart: await this.settingsStore.get<string>(DESKTOP_CODEX_BIN_SETTING_KEY),
      onProgress: (event) => this.emitProgress(event),
      readVersion: (bin) => this.readVersion(bin),
      persist: (binPath, valueAtStart) =>
        this.managedBinPersister
          ? this.managedBinPersister(binPath, valueAtStart)
          : this.settingsStore.set(DESKTOP_CODEX_BIN_SETTING_KEY, binPath),
    })
    return status ?? (await this.probeStatus())
  }

  private async resolveBinPath(): Promise<string | null> {
    const fromSettings = await this.settingsStore.get<string>(
      DESKTOP_CODEX_BIN_SETTING_KEY,
    )
    if (typeof fromSettings === 'string' && fromSettings.trim()) {
      const validated = await this.validateExecutable(
        expandUserPath(fromSettings.trim(), this.resolveHomedir),
      )
      if (validated && (await this.isCodexBinary(validated))) return validated
    }

    const fromEnv = this.env.ECOS_AGENT_CODEX_BIN
    if (typeof fromEnv === 'string' && fromEnv.trim()) {
      const validated = await this.validateExecutable(
        expandUserPath(fromEnv.trim(), this.resolveHomedir),
      )
      if (validated && (await this.isCodexBinary(validated))) return validated
    }

    const managed = join(this.installRoot, 'bin', 'codex')
    const managedValidated = await this.validateExecutable(managed)
    if (managedValidated && (await this.isCodexBinary(managedValidated))) {
      return managedValidated
    }

    return await this.whichCodex()
  }

  /** Confirm an executable actually identifies as a Codex CLI. */
  private async isCodexBinary(bin: string): Promise<boolean> {
    const version = await this.readVersion(bin)
    return Boolean(version && /^codex[\s_-]/i.test(version))
  }

  private async whichCodex(): Promise<string | null> {
    const pathValue = this.env.PATH ?? ''
    for (const entry of pathValue.split(':')) {
      if (!entry) continue
      const candidate = join(entry, 'codex')
      const validated = await this.validateExecutable(candidate)
      // A PATH candidate must identify as Codex too, or it would be injected
      // into the agent environment.
      if (validated && (await this.isCodexBinary(validated))) return validated
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
      const { code, stdout } = await this.runCommandCapture(bin, ['--version'], {
        env: this.commandEnv(bin),
        timeoutMs: 8_000,
      })
      if (code !== 0) return null
      const line = stdout.trim().split(/\r?\n/)[0]?.trim()
      return line || null
    } catch {
      return null
    }
  }

  private async detectAuthState(bin: string): Promise<DesktopCodexAuthState> {
    try {
      const { code, stdout, stderr } = await this.runCommandCapture(
        bin,
        ['login', 'status'],
        {
          env: this.commandEnv(bin),
          timeoutMs: 8_000,
        },
      )
      // A probe that timed out (code null) carries untrustworthy partial
      // output; fall through to the auth file probe instead of parsing it.
      if (code === null) throw new Error('codex login status timed out')
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
      // A broken listener (for example a renderer that died mid-notification)
      // must not fail the install or trigger its rollback path.
      try {
        listener(event)
      } catch {
        // ignore
      }
    }
  }

  private commandEnv(bin: string): NodeJS.ProcessEnv {
    return { ...this.env, PATH: prependPath(dirname(bin), this.env.PATH) }
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
  ): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
    return captureCommandOutput(
      command,
      args,
      {
        env: options.env ?? this.env,
        timeoutMs: options.timeoutMs,
      },
      this.spawnImpl,
    )
  }
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
