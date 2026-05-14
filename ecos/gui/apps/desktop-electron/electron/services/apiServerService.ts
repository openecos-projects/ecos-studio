import { spawn, type ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer, Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import type { VersionInfo } from '@ecos-studio/shared'
import { electronLogger } from './logger'

const API_HOST = '127.0.0.1'
const DEFAULT_API_PORT = 8765
const MAX_API_PORT = 8865
const API_READY_TIMEOUT_SECS_DEFAULT = 180
const API_HEALTH_TIMEOUT_MS = 2_000
const UNKNOWN_VERSION = 'unknown'

type ServerOwnership = 'none' | 'owned' | 'external'

interface LaunchSpec {
  args: string[]
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  mode: 'dev' | 'packaged'
}

interface ServerStartResult {
  ownership: Exclude<ServerOwnership, 'none'>
  port: number
  process: ChildProcess | null
}

interface HealthResponse {
  instance_token?: string
  status?: string
}

type BackendVersionInfo = Pick<VersionInfo, 'server' | 'ecc' | 'dreamplace'>

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function getApiLogLevel(): string {
  const configuredLevel = process.env.ECOS_API_LOG_LEVEL?.trim()
  return configuredLevel || 'warning'
}

function getLogsDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

function createLogSessionId(date = new Date(), pid = process.pid): string {
  const year = date.getFullYear()
  const month = padDatePart(date.getMonth() + 1)
  const day = padDatePart(date.getDate())
  const hours = padDatePart(date.getHours())
  const minutes = padDatePart(date.getMinutes())
  const seconds = padDatePart(date.getSeconds())
  return `${year}${month}${day}-${hours}${minutes}${seconds}-${pid}`
}

const logSessionId = createLogSessionId()

export function getLogSessionId(): string {
  return logSessionId
}

function getLogSessionDirectory(): string {
  return join(getLogsDirectory(), 'sessions', logSessionId)
}

export function getElectronLatestMainLogFile(): string {
  return join(getLogsDirectory(), 'main.log')
}

export function getApiServerLatestLogFile(): string {
  return join(getLogsDirectory(), 'api-server.log')
}

export function getElectronMainLogFile(): string {
  return join(getLogSessionDirectory(), 'main.log')
}

export function getApiServerLogFile(): string {
  return join(getLogSessionDirectory(), 'api-server.log')
}

function getApiReadyTimeoutMs(): number {
  const rawValue = process.env.ECOS_API_READY_TIMEOUT_SECS?.trim()
  if (!rawValue) {
    return API_READY_TIMEOUT_SECS_DEFAULT * 1000
  }

  const timeoutSecs = Number.parseInt(rawValue, 10)
  if (Number.isFinite(timeoutSecs) && timeoutSecs > 0) {
    return timeoutSecs * 1000
  }

  electronLogger.warn(
    '[desktop-electron] ECOS_API_READY_TIMEOUT_SECS=%s is invalid; falling back to %ds',
    rawValue,
    API_READY_TIMEOUT_SECS_DEFAULT,
  )
  return API_READY_TIMEOUT_SECS_DEFAULT * 1000
}

function createApiServerArgs(port: number, extraArgs: string[] = []): string[] {
  return [
    '--host',
    API_HOST,
    '--port',
    String(port),
    ...extraArgs,
    '--disable-stdio-redirect',
    '--log-file',
    getApiServerLogFile(),
    '--log-level',
    getApiLogLevel(),
  ]
}

function createPythonServerArgs(
  serverScriptPath: string,
  port: number,
  extraArgs: string[] = [],
): string[] {
  return [
    serverScriptPath,
    ...createApiServerArgs(port, extraArgs),
  ]
}

function createApiServerEnv(token: string): NodeJS.ProcessEnv {
  const apiLogFile = getApiServerLogFile()
  return {
    ...process.env,
    ECOS_API_LATEST_LOG_FILE: getApiServerLatestLogFile(),
    ECOS_API_LOG_FILE: apiLogFile,
    ECOS_API_LOG_LEVEL: getApiLogLevel(),
    ECOS_SERVER_INSTANCE_TOKEN: token,
  }
}

function isLaunchedFromTerminal(): boolean {
  return Boolean(process.stdout.isTTY || process.stderr.isTTY)
}

function createGuiOnlyVersionInfo(): VersionInfo {
  return {
    gui: app.getVersion(),
    server: UNKNOWN_VERSION,
    ecc: UNKNOWN_VERSION,
    dreamplace: UNKNOWN_VERSION,
  }
}

function readVersionField(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : UNKNOWN_VERSION
}

function normalizeBackendVersionInfo(value: unknown): BackendVersionInfo {
  const record =
    value && typeof value === 'object' ? value as Record<string, unknown> : {}

  return {
    server: readVersionField(record.server),
    ecc: readVersionField(record.ecc),
    dreamplace: readVersionField(record.dreamplace),
  }
}

function generateInstanceToken(port: number): string {
  const seed = `${process.pid}:${port}:${Date.now()}:${Math.random()}`
  return createHash('sha256').update(seed).digest('hex')
}

function candidatePorts(): number[] {
  return Array.from({ length: MAX_API_PORT - DEFAULT_API_PORT + 1 }, (_, index) =>
    DEFAULT_API_PORT + index,
  )
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close(() => {
        resolve(true)
      })
    })

    server.listen(port, API_HOST)
  })
}

async function canConnectToPort(port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = new Socket()

    const finish = (result: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, API_HOST)
  })
}

async function fetchHealthResponse(port: number, timeoutMs: number): Promise<HealthResponse | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(`http://${API_HOST}:${port}/health`, {
      method: 'GET',
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    return (await response.json()) as HealthResponse
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchBackendVersions(port: number): Promise<BackendVersionInfo> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, API_HEALTH_TIMEOUT_MS)

  try {
    const response = await fetch(`http://${API_HOST}:${port}/api/about`, {
      method: 'GET',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`version endpoint returned HTTP ${response.status}`)
    }

    return normalizeBackendVersionInfo(await response.json())
  } finally {
    clearTimeout(timeout)
  }
}

async function isApiServerHealthy(
  port: number,
  expectedToken?: string,
): Promise<boolean> {
  const json = await fetchHealthResponse(port, API_HEALTH_TIMEOUT_MS)

  if (!json || json.status !== 'ok') {
    return false
  }

  if (!expectedToken) {
    return true
  }

  return json.instance_token === expectedToken
}

function getServerDirectory(): string {
  const configuredServerDirectory = process.env.ECOS_SERVER_DIRECTORY?.trim()
  if (configuredServerDirectory) {
    return configuredServerDirectory
  }

  return fileURLToPath(new URL('../../../../../server/', import.meta.url))
}

function getServerScriptPath(): string {
  return join(getServerDirectory(), 'run_server.py')
}

function getPythonInterpreterPath(): string {
  const serverDirectory = getServerDirectory()
  const venvPython =
    process.platform === 'win32'
      ? join(serverDirectory, '.venv', 'Scripts', 'python.exe')
      : join(serverDirectory, '.venv', 'bin', 'python3')

  return venvPython
}

function getBundledBinaryCandidates(): string[] {
  const extension = process.platform === 'win32' ? '.exe' : ''
  const archSpecificCandidates: string[] = []

  if (process.platform === 'linux' && process.arch === 'x64') {
    archSpecificCandidates.push(`api-server-x86_64-unknown-linux-gnu${extension}`)
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    archSpecificCandidates.push(`api-server-aarch64-apple-darwin${extension}`)
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    archSpecificCandidates.push(`api-server-x86_64-apple-darwin${extension}`)
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    archSpecificCandidates.push(`api-server-x86_64-pc-windows-msvc${extension}`)
  }

  return [...archSpecificCandidates, `api-server${extension}`]
}

function getBundledServerExecutableName(): string {
  return process.platform === 'win32' ? 'ecos-server.exe' : 'ecos-server'
}

function getConfiguredBinariesDirectory(): string | null {
  const configuredDirectory = process.env.ECOS_ELECTRON_BINARIES_DIR?.trim()
  return configuredDirectory ? configuredDirectory : null
}

function getConfiguredOssCadDirectory(): string | null {
  const configuredDirectory = process.env.ECOS_ELECTRON_OSS_CAD_DIR?.trim()
  return configuredDirectory ? configuredDirectory : null
}

function getProcessResourcesPath(): string | null {
  const resourcesPath = process.resourcesPath?.trim()
  return resourcesPath ? resourcesPath : null
}

async function resolveLaunchSpec(port: number, token: string): Promise<LaunchSpec> {
  const serverDirectory = getServerDirectory()
  const serverScriptPath = getServerScriptPath()
  const venvPythonPath = getPythonInterpreterPath()

  if (!app.isPackaged || (await pathExists(serverScriptPath))) {
    const command = (await pathExists(venvPythonPath))
      ? venvPythonPath
      : process.platform === 'win32'
        ? 'python'
        : 'python3'
    const args = createPythonServerArgs(
      serverScriptPath,
      port,
      app.isPackaged ? [] : ['--reload', '--reload-dir', serverDirectory],
    )

    return {
      command,
      args,
      cwd: serverDirectory,
      env: createApiServerEnv(token),
      mode: 'dev',
    }
  }

  const binaryCandidates = getBundledBinaryCandidates()
  const processResourcesPath = getProcessResourcesPath()
  const searchDirectories = [
    getConfiguredBinariesDirectory(),
    dirname(process.execPath),
    join(dirname(process.execPath), 'binaries'),
    processResourcesPath,
    processResourcesPath ? join(processResourcesPath, 'binaries') : null,
  ].filter((directory): directory is string => !!directory)

  for (const directory of searchDirectories) {
    for (const binaryName of binaryCandidates) {
      const binaryPath = join(directory, binaryName)

      if (!(await pathExists(binaryPath))) {
        continue
      }

      const bundledDirectoryExecutable = join(binaryPath, getBundledServerExecutableName())
      const command = (await pathExists(bundledDirectoryExecutable))
        ? bundledDirectoryExecutable
        : binaryPath
      const cwd = (await pathExists(bundledDirectoryExecutable))
        ? binaryPath
        : dirname(binaryPath)

      const resourcesDirectory =
        getConfiguredOssCadDirectory()
        ?? (processResourcesPath
          ? join(processResourcesPath, 'resources', 'oss-cad-suite')
          : null)
      const env: NodeJS.ProcessEnv = createApiServerEnv(token)

      if (resourcesDirectory && (await pathExists(resourcesDirectory))) {
        env.CHIPCOMPILER_OSS_CAD_DIR = resourcesDirectory
      } else if (resourcesDirectory) {
        electronLogger.warn(
          '[desktop-electron] Expected oss-cad-suite at %s, but it was not found.',
          resourcesDirectory,
        )
      }

      return {
        command,
        args: createApiServerArgs(port),
        cwd,
        env,
        mode: 'packaged',
      }
    }
  }

  throw new Error('Unable to locate an API server launch target.')
}

type ReadyState =
  | { status: 'ready' }
  | { status: 'port-conflict' }
  | { message: string; status: 'failed' }

async function waitForServerReady(
  child: ChildProcess,
  port: number,
  expectedToken: string,
  timeoutMs: number,
): Promise<ReadyState> {
  const startTime = Date.now()
  let delayMs = 100
  let attempt = 0
  let spawnError: Error | null = null
  child.once('error', (error) => {
    spawnError = error
  })

  electronLogger.info(
    '[desktop-electron] Waiting for FastAPI server on port %d (timeout: %ds, token check: %s)',
    port,
    Math.ceil(timeoutMs / 1000),
    'enabled',
  )

  while (Date.now() - startTime < timeoutMs) {
    attempt += 1

    if (spawnError) {
      return {
        status: 'failed',
        message: (spawnError as Error).message,
      }
    }

    if ((await canConnectToPort(port, 200)) && (await isApiServerHealthy(port, expectedToken))) {
      electronLogger.info(
        '[desktop-electron] FastAPI server ready on port %d after %d attempts (%.1fs)',
        port,
        attempt,
        (Date.now() - startTime) / 1000,
      )
      return { status: 'ready' }
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      if (!(await isPortAvailable(port))) {
        electronLogger.warn(
          '[desktop-electron] API server exited before readiness on port %d and the port is now occupied; treating as port conflict',
          port,
        )
        return { status: 'port-conflict' }
      }

      return {
        status: 'failed',
        message: `server process exited before readiness with status ${child.exitCode ?? child.signalCode}`,
      }
    }

    if (Date.now() - startTime >= 4000 && attempt % 3 === 0) {
      electronLogger.info(
        '[desktop-electron] Still waiting for FastAPI server on port %d (%.1fs elapsed, attempt %d)',
        port,
        (Date.now() - startTime) / 1000,
        attempt,
      )
    }

    await wait(delayMs)
    delayMs = Math.min(Math.floor((delayMs * 3) / 2), 1000)
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    if (!(await isPortAvailable(port))) {
      return { status: 'port-conflict' }
    }

    return {
      status: 'failed',
      message: `server exited before readiness with status ${child.exitCode ?? child.signalCode}`,
    }
  }

  return {
    status: 'failed',
    message: `server did not become ready on port ${port} within ${timeoutMs}ms`,
  }
}

export class ApiServerService {
  private currentPort: number | null = null
  private ownedProcess: ChildProcess | null = null
  private ownership: ServerOwnership = 'none'
  private startupError: Error | null = null
  private startupPromise: Promise<void> | null = null

  async start(): Promise<void> {
    if (this.ownership === 'external') {
      return
    }

    if (
      this.ownership === 'owned' &&
      this.ownedProcess &&
      this.ownedProcess.exitCode === null &&
      this.ownedProcess.signalCode === null
    ) {
      return
    }

    if (this.startupPromise) {
      return await this.startupPromise
    }

    this.startupError = null
    this.startupPromise = this.startInternal()
      .catch((error) => {
        const startupError =
          error instanceof Error ? error : new Error(String(error))
        this.currentPort = null
        this.ownedProcess = null
        this.ownership = 'none'
        this.startupError = startupError
        throw startupError
      })
      .finally(() => {
        this.startupPromise = null
      })

    await this.startupPromise
  }

  async getPort(): Promise<number> {
    if (this.startupPromise) {
      await this.startupPromise
    }

    if (this.startupError) {
      throw this.startupError
    }

    if (this.currentPort == null) {
      throw new Error('API server has not been started.')
    }

    electronLogger.debug('[desktop-electron] API server port: %d', this.currentPort)
    return this.currentPort
  }

  async getVersions(): Promise<VersionInfo> {
    const versions = createGuiOnlyVersionInfo()

    try {
      const backendVersions = await fetchBackendVersions(await this.getPort())
      return {
        ...versions,
        ...backendVersions,
      }
    } catch (error) {
      electronLogger.warn('[desktop-electron] Failed to get backend versions:', error)
      return versions
    }
  }

  async stop(): Promise<void> {
    if (this.ownership !== 'owned' || !this.ownedProcess) {
      return
    }

    const child = this.ownedProcess
    const port = this.currentPort
    this.currentPort = null
    this.ownedProcess = null
    this.ownership = 'none'

    electronLogger.info(
      '[desktop-electron] Stopping FastAPI server (PID: %s, port: %s)',
      child.pid ?? 'unknown',
      port ?? 'unknown',
    )
    await stopOwnedProcess(child)
  }

  private async startInternal(): Promise<void> {
    const result = await this.startServer()
    this.currentPort = result.port
    this.ownership = result.ownership
    this.ownedProcess = result.process
    this.startupError = null
  }

  private async startServer(): Promise<ServerStartResult> {
    if (
      !(await isPortAvailable(DEFAULT_API_PORT)) &&
      (await isApiServerHealthy(DEFAULT_API_PORT))
    ) {
      if (process.env.ECOS_REUSE_API_SERVER === '1') {
        electronLogger.info(
          '[desktop-electron] Healthy API server on port %d and ECOS_REUSE_API_SERVER=1; reusing it',
          DEFAULT_API_PORT,
        )
        return {
          ownership: 'external',
          port: DEFAULT_API_PORT,
          process: null,
        }
      }

      electronLogger.warn(
        '[desktop-electron] Port %d has a healthy API server but ECOS_REUSE_API_SERVER is not set; trying another port',
        DEFAULT_API_PORT,
      )
    }

    for (const port of candidatePorts()) {
      if (!(await isPortAvailable(port))) {
        electronLogger.debug('[desktop-electron] Skipping occupied port %d', port)
        continue
      }

      const token = generateInstanceToken(port)
      const launchSpec = await resolveLaunchSpec(port, token)
      const inheritStdio = !app.isPackaged || isLaunchedFromTerminal()
      electronLogger.info(
        '[desktop-electron] Starting FastAPI server (%s mode) from %s on port %d',
        launchSpec.mode,
        launchSpec.command,
        port,
      )
      electronLogger.info(
        '[desktop-electron] Server output -> %s',
        inheritStdio ? 'terminal (stdio)' : 'discarded (desktop mode, no terminal)',
      )
      electronLogger.info('[desktop-electron] Workspace logs will be saved to <workspace>/log/')
      const child = spawn(launchSpec.command, launchSpec.args, {
        cwd: launchSpec.cwd,
        detached: process.platform !== 'win32',
        env: launchSpec.env,
        stdio: inheritStdio ? 'inherit' : 'ignore',
      })

      const readyState = await waitForServerReady(child, port, token, getApiReadyTimeoutMs())

      if (readyState.status === 'ready') {
        electronLogger.info(
          '[desktop-electron] FastAPI server started with PID %s on port %d',
          child.pid ?? 'unknown',
          port,
        )
        return {
          ownership: 'owned',
          port,
          process: child,
        }
      }

      await stopOwnedProcess(child)

      if (readyState.status === 'port-conflict') {
        electronLogger.warn(
          '[desktop-electron] Port %d was lost during startup; retrying on next candidate',
          port,
        )
        continue
      }

      electronLogger.error(
        '[desktop-electron] Failed to start FastAPI server on port %d: %s',
        port,
        readyState.message,
      )
      throw new Error(readyState.message)
    }

    throw new Error(
      `Cannot start API server: no usable port found (tried ${DEFAULT_API_PORT} - ${MAX_API_PORT})`,
    )
  }
}

async function stopOwnedProcess(child: ChildProcess): Promise<void> {
  if (!child.pid) {
    return
  }

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      })
      killer.once('exit', () => resolve())
      killer.once('error', () => {
        child.kill()
        resolve()
      })
    })
    return
  }

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }

  await wait(500)

  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

export { DEFAULT_API_PORT }
