import { spawn as spawnChild } from 'node:child_process'
import type { VersionInfo } from '@ecos-studio/shared'

type SpawnLike = typeof spawnChild

export interface AppInfoServiceOptions {
  appVersionProvider: () => string
  command?: string
  env?: NodeJS.ProcessEnv
  spawn?: SpawnLike
}

const UNKNOWN_VERSION = 'unknown'

function dataToString(data: unknown): string {
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
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
    return {
      dreamplace: UNKNOWN_VERSION,
      ecc: await this.getEccVersion(),
      gui: this.appVersionProvider(),
      runtime: 'ECC CLI',
    }
  }

  private async getEccVersion(): Promise<string> {
    return await new Promise((resolve) => {
      let stdout = ''
      const child = this.spawnImpl(this.command, ['--version'], {
        env: this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      child.stdout?.on('data', (data) => {
        stdout += dataToString(data)
      })

      child.once('error', () => {
        resolve(UNKNOWN_VERSION)
      })

      child.once('close', (code) => {
        const version = stdout.trim()
        resolve(code === 0 && version ? version : UNKNOWN_VERSION)
      })
    })
  }
}
