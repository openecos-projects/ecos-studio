import { pathToFileURL } from 'node:url'
import {
  resolveProjectFileAbsolutePath,
  type TileGenerationRequest,
  type TileGenerationResult,
} from '@ecos-studio/shared'
import {
  finalizeLayoutTileCacheMeta,
  getLayoutTileCacheStatus,
  prepareLayoutTileCache,
} from '@ecos-studio/tile-helper'
import { WorkerTileGenerationRunner, type TileGenerationRunner } from './tileGenerationRunner'

export interface TileProjectRootProvider {
  getProjectRoot(): Promise<string>
}

export interface TileServiceOptions {
  projectRootProvider: TileProjectRootProvider
  tileGenerationRunner?: TileGenerationRunner
}

export function resolveLayoutJsonAbsolutePath(
  projectPath: string,
  layoutJsonRelative: string,
): string {
  return resolveProjectFileAbsolutePath(projectPath, layoutJsonRelative)
}

export class TileService {
  private readonly projectRootProvider: TileProjectRootProvider
  private readonly tileGenerationRunner: TileGenerationRunner

  constructor(options: TileServiceOptions) {
    this.projectRootProvider = options.projectRootProvider
    this.tileGenerationRunner = options.tileGenerationRunner ?? new WorkerTileGenerationRunner()
  }

  async getStatus(request: TileGenerationRequest): Promise<TileGenerationResult> {
    const projectRoot = await this.projectRootProvider.getProjectRoot()
    const layoutJsonPath = resolveLayoutJsonAbsolutePath(
      request.projectPath,
      request.layoutJsonRelative,
    )
    const status = await getLayoutTileCacheStatus({
      projectPath: request.projectPath,
      projectRoot,
      stepKey: request.stepKey,
      layoutJsonPath,
    })

    return {
      baseUrl: pathToFileURL(status.outDir).href,
      outDir: status.outDir,
      fromCache: status.fromCache,
    }
  }

  async generate(request: TileGenerationRequest): Promise<TileGenerationResult> {
    const projectRoot = await this.projectRootProvider.getProjectRoot()
    const layoutJsonPath = resolveLayoutJsonAbsolutePath(
      request.projectPath,
      request.layoutJsonRelative,
    )
    const prep = await prepareLayoutTileCache({
      projectPath: request.projectPath,
      projectRoot,
      stepKey: request.stepKey,
      layoutJsonPath,
    })

    if (!prep.fromCache) {
      await this.tileGenerationRunner.run(layoutJsonPath, prep.outDir)
      await finalizeLayoutTileCacheMeta({
        projectRoot,
        outDir: prep.outDir,
        layoutJsonPath,
        contentSha256: prep.contentSha256,
      })
    }

    return {
      baseUrl: pathToFileURL(prep.outDir).href,
      outDir: prep.outDir,
      fromCache: prep.fromCache,
    }
  }
}
