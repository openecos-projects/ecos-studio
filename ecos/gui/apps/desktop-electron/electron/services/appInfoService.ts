import { spawn as spawnChild } from 'node:child_process'
import type { VersionInfo } from '@ecos-studio/shared'

type SpawnLike = typeof spawnChild
type EccComponentVersions = Pick<VersionInfo, 'runtime' | 'ecc' | 'dreamplace' | 'eccTools'>

export interface AppInfoServiceOptions {
  appVersionProvider: () => string
  command?: string
  env?: NodeJS.ProcessEnv
  spawn?: SpawnLike
}

const UNKNOWN_VERSION = 'unknown'
const DEFAULT_RUNTIME = 'ECC CLI'

function dataToString(data: unknown): string {
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function parseLegacyEccVersion(stdout: string): string {
  const version = stdout.trim()
  return version.startsWith('ecc ') ? version.slice(4).trim() : version
}

export class AppInfoService {
  private readonly appVersionProvider: () => string
  private readonly command: string
  private readonly env: NodeJS.ProcessEnv
  private readonly spawnImpl: SpawnLike

  constructor(options: AppInfoServiceOptions) {
    this.appVersionProvider = options.appVersionProvider
    this.command = options.command ?? 'ecc'
    this.env = { ...(options.env ?? process.env) }
    this.spawnImpl = options.spawn ?? spawnChild
  }

  async getVersions(): Promise<VersionInfo> {
    const eccVersions = await this.getEccVersions()

    return {
      ...eccVersions,
      gui: this.appVersionProvider(),
    }
  }

  private async getEccVersions(): Promise<EccComponentVersions> {
    const structuredVersions = await this.getStructuredEccVersions()
    if (structuredVersions !== null) {
      return structuredVersions
    }

    return {
      dreamplace: UNKNOWN_VERSION,
      ecc: await this.getLegacyEccVersion(),
      eccTools: UNKNOWN_VERSION,
      runtime: DEFAULT_RUNTIME,
    }
  }

  private async getStructuredEccVersions(): Promise<EccComponentVersions | null> {
    const stdout = await this.runEccCommand(['version', '--json'])
    if (stdout === null || !stdout.trim()) {
      return null
    }

    let payload: unknown
    try {
      payload = JSON.parse(stdout)
    } catch {
      return null
    }

    if (!isRecord(payload)) {
      return null
    }

    return {
      dreamplace: stringValue(payload.dreamplace, UNKNOWN_VERSION),
      ecc: stringValue(payload.ecc, UNKNOWN_VERSION),
      eccTools: stringValue(payload.ecc_tools, UNKNOWN_VERSION),
      runtime: stringValue(payload.runtime, DEFAULT_RUNTIME),
    }
  }

  private async getLegacyEccVersion(): Promise<string> {
    const stdout = await this.runEccCommand(['--version'])
    if (stdout === null) {
      return UNKNOWN_VERSION
    }

    return parseLegacyEccVersion(stdout) || UNKNOWN_VERSION
  }

  private async runEccCommand(args: string[]): Promise<string | null> {
    return await new Promise((resolve) => {
      let stdout = ''
      const child = this.spawnImpl(this.command, args, {
        env: this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      child.stdout?.on('data', (data) => {
        stdout += dataToString(data)
      })

      child.once('error', () => {
        resolve(null)
      })

      child.once('close', (code) => {
        resolve(code === 0 ? stdout : null)
      })
    })
  }
}
