import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { rename, rm, writeFile } from 'node:fs/promises'
import {
  buildEnvFileContent as composeEnvFileContent,
  pathSeparator,
} from './cliInstallerArtifacts'
import { createEccRuntimeEnv, type EccRuntimeEnvOptions } from './eccRpc/runtimeEnv'

/** The subset of ResourceManagerService the env writer consumes. */
export interface CliEnvWriterResourceManager {
  createRuntimeEnv(
    baseEnv: NodeJS.ProcessEnv,
    options: { platform: NodeJS.Platform },
  ): Promise<NodeJS.ProcessEnv>
}

export interface CliEnvWriterOptions {
  resourceManager: CliEnvWriterResourceManager
  platform: NodeJS.Platform
  eccRuntimeOptions: () => EccRuntimeEnvOptions
}

/**
 * Builds the merged ECC runtime env and the generated env file. Kept apart
 * from the installer orchestration because both drift-sync regeneration and
 * the install pipeline need the exact same derivation.
 */
export class CliInstallerEnvWriter {
  private readonly resourceManager: CliEnvWriterResourceManager
  private readonly platform: NodeJS.Platform
  private readonly eccRuntimeOptions: () => EccRuntimeEnvOptions

  constructor(options: CliEnvWriterOptions) {
    this.resourceManager = options.resourceManager
    this.platform = options.platform
    this.eccRuntimeOptions = options.eccRuntimeOptions
  }

  async buildRuntimeEnv(binariesDirOverride?: string): Promise<NodeJS.ProcessEnv> {
    const baseEccEnv = createEccRuntimeEnv(this.eccRuntimeOptions())
    const runtimeEnv = await this.resourceManager.createRuntimeEnv(baseEccEnv, {
      platform: this.platform,
    })
    if (!binariesDirOverride) return runtimeEnv
    const separator = pathSeparator(this.platform)
    const libDir = join(binariesDirOverride, '_internal', 'ecc_tools_bin', 'lib')
    return {
      ...runtimeEnv,
      PATH: `${binariesDirOverride}${separator}${runtimeEnv.PATH ?? ''}`,
      ...(this.platform === 'linux' && existsSync(libDir)
        ? { LD_LIBRARY_PATH: `${libDir}:${runtimeEnv.LD_LIBRARY_PATH ?? ''}` }
        : {}),
    }
  }

  /**
   * Write the generated env file into `targetDir`. A concurrent ecos-ecc
   * invocation sources the file at exec time; write to a sibling temp file
   * and rename so readers never see a truncated or half-written file.
   */
  async writeEnvFile(
    targetDir: string,
    eccBinDir: string | null,
    libDirProbe?: string,
  ): Promise<void> {
    const content = await this.buildEnvFileContent(eccBinDir, libDirProbe)
    const envPath = join(targetDir, 'env')
    const tempPath = join(targetDir, `.env.tmp-${randomUUID().slice(0, 8)}`)
    try {
      await writeFile(tempPath, content)
      await rename(tempPath, envPath)
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async buildEnvFileContent(
    eccBinDir: string | null,
    libDirProbe?: string,
  ): Promise<string> {
    const runtimeEnv = await this.buildRuntimeEnv()
    const toolOnlyEnv = await this.resourceManager.createRuntimeEnv(
      {},
      { platform: this.platform },
    )
    return composeEnvFileContent({
      runtimeEnv,
      toolPathValue: toolOnlyEnv.PATH ?? '',
      platform: this.platform,
      eccBinDir,
      libDirProbe,
    })
  }
}
