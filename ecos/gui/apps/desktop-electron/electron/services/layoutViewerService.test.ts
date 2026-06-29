import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LayoutViewerService } from './layoutViewerService'

interface ExecFileResult {
  stdout: string
  stderr: string
}

const CURRENT_SOURCE_METADATA = {
  generator: {
    build_id: 'current-packer-build-id',
    name: 'ecos-layout-packer',
    version: '0.1.0',
  },
  source: {
    fingerprint: 'current-source-fingerprint',
    kind: 'view-json',
  },
}

function layoutPackageManifest(
  fingerprint = CURRENT_SOURCE_METADATA.source.fingerprint,
  buildId = CURRENT_SOURCE_METADATA.generator.build_id,
) {
  return JSON.stringify({
    generator: {
      ...CURRENT_SOURCE_METADATA.generator,
      build_id: buildId,
    },
    schema: 'ecos.layoutpkg.v1',
    source: {
      fingerprint,
      kind: 'view-json',
    },
    tilesets: {
      detail: 'detail/index.json',
    },
    version: 1,
    world_bbox: [0, 0, 100, 100],
  })
}

function createService(options: {
  appPath?: string
  cwd?: string
  execFile?: (file: string, args: string[]) => Promise<ExecFileResult>
  files?: Record<string, string>
  existingPaths?: string[]
  isPackaged?: boolean
  resourcesPath?: string
}) {
  const files = new Map(Object.entries(options.files ?? {}))
  const execFile = options.execFile ?? vi.fn(async () => ({
    stderr: '',
    stdout: '',
  }))
  const unref = vi.fn()
  const spawnProcess = vi.fn(() => ({ unref }))
  const existingPaths = new Set([
    ...(options.existingPaths ?? []),
    ...files.keys(),
  ])
  const service = new LayoutViewerService({
    appPath: options.appPath ?? '/repo/ecos/gui/apps/desktop-electron',
    cwd: options.cwd ?? '/repo/ecos/gui/apps/desktop-electron',
    env: {},
    execFile,
    fileExists: (path) => existingPaths.has(path),
    isPackaged: options.isPackaged ?? false,
    platform: 'linux',
    readTextFile: async (path) => {
      const text = files.get(path)
      if (text === undefined) {
        throw new Error(`file not found: ${path}`)
      }
      return text
    },
    resourcesPath: options.resourcesPath,
    spawnProcess,
  })

  return {
    execFile,
    service,
    spawnProcess,
    unref,
  }
}

describe('LayoutViewerService', () => {
  it('packs a relative view JSON root and launches the dev native viewer', async () => {
    const packageRoot = '/project/output/gcd_route_view'
    const repoRoot = '/repo'
    const releaseDir = join(repoRoot, 'ecos/layout-viewer/target/release')
    const packer = join(releaseDir, 'ecos-layout-packer')
    const viewer = join(releaseDir, 'layout-viewer-native')
    const layoutPackagePath = join(packageRoot, '.layoutpkg')
    const { execFile, service, spawnProcess, unref } = createService({
      existingPaths: [
        join(repoRoot, 'ecos/layout-viewer/Cargo.toml'),
        packer,
        viewer,
      ],
    })

    const result = await service.open({
      projectPath: '/project',
      viewJsonPackageRoot: 'output/gcd_route_view',
    })

    expect(execFile).toHaveBeenCalledWith(packer, [packageRoot, layoutPackagePath])
    expect(spawnProcess).toHaveBeenCalledWith(
      viewer,
      [layoutPackagePath],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }),
    )
    expect(unref).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      layoutPackagePath,
      packageRoot,
      spawned: true,
    })
  })

  it('reuses an existing .layoutpkg manifest when the source fingerprint and generator match', async () => {
    const packageRoot = '/project/output/gcd_route_view'
    const repoRoot = '/repo'
    const debugDir = join(repoRoot, 'ecos/layout-viewer/target/debug')
    const packer = join(debugDir, 'ecos-layout-packer')
    const viewer = join(debugDir, 'layout-viewer-native')
    const layoutPackagePath = join(packageRoot, '.layoutpkg')
    const manifestPath = join(layoutPackagePath, 'manifest.json')
    const execFileRunner = vi.fn(async (file: string, args: string[]) => {
      if (file === packer && args.join(' ') === `--fingerprint --json ${packageRoot}`) {
        return {
          stderr: '',
          stdout: JSON.stringify(CURRENT_SOURCE_METADATA),
        }
      }
      return {
        stderr: '',
        stdout: '',
      }
    })
    const { execFile, service, spawnProcess } = createService({
      execFile: execFileRunner,
      files: {
        [manifestPath]: layoutPackageManifest(),
      },
      existingPaths: [
        join(repoRoot, 'ecos/layout-viewer/Cargo.toml'),
        packer,
        viewer,
      ],
    })

    await service.open({
      projectPath: '/project',
      viewJsonPackageRoot: packageRoot,
    })

    expect(execFile).toHaveBeenCalledWith(packer, ['--fingerprint', '--json', packageRoot])
    expect(execFile).not.toHaveBeenCalledWith(packer, [packageRoot, layoutPackagePath])
    expect(spawnProcess).toHaveBeenCalledWith(
      viewer,
      [layoutPackagePath],
      expect.any(Object),
    )
  })

  it('rebuilds an existing .layoutpkg when the source fingerprint changes', async () => {
    const packageRoot = '/project/output/gcd_route_view'
    const repoRoot = '/repo'
    const debugDir = join(repoRoot, 'ecos/layout-viewer/target/debug')
    const packer = join(debugDir, 'ecos-layout-packer')
    const viewer = join(debugDir, 'layout-viewer-native')
    const layoutPackagePath = join(packageRoot, '.layoutpkg')
    const manifestPath = join(layoutPackagePath, 'manifest.json')
    const execFile = vi.fn(async (file: string, args: string[]) => {
      if (file === packer && args.join(' ') === `--fingerprint --json ${packageRoot}`) {
        return {
          stderr: '',
          stdout: JSON.stringify(CURRENT_SOURCE_METADATA),
        }
      }
      return {
        stderr: '',
        stdout: '',
      }
    })
    const { service } = createService({
      execFile,
      files: {
        [manifestPath]: layoutPackageManifest('stale-source-fingerprint'),
      },
      existingPaths: [
        join(repoRoot, 'ecos/layout-viewer/Cargo.toml'),
        packer,
        viewer,
      ],
    })

    await service.open({
      projectPath: '/project',
      viewJsonPackageRoot: packageRoot,
    })

    expect(execFile).toHaveBeenCalledWith(packer, ['--fingerprint', '--json', packageRoot])
    expect(execFile).toHaveBeenCalledWith(packer, [packageRoot, layoutPackagePath])
  })

  it('rebuilds an existing .layoutpkg when the packer build id changes', async () => {
    const packageRoot = '/project/output/gcd_route_view'
    const repoRoot = '/repo'
    const debugDir = join(repoRoot, 'ecos/layout-viewer/target/debug')
    const packer = join(debugDir, 'ecos-layout-packer')
    const viewer = join(debugDir, 'layout-viewer-native')
    const layoutPackagePath = join(packageRoot, '.layoutpkg')
    const manifestPath = join(layoutPackagePath, 'manifest.json')
    const execFile = vi.fn(async (file: string, args: string[]) => {
      if (file === packer && args.join(' ') === `--fingerprint --json ${packageRoot}`) {
        return {
          stderr: '',
          stdout: JSON.stringify(CURRENT_SOURCE_METADATA),
        }
      }
      return {
        stderr: '',
        stdout: '',
      }
    })
    const { service } = createService({
      execFile,
      files: {
        [manifestPath]: layoutPackageManifest(undefined, 'stale-packer-build-id'),
      },
      existingPaths: [
        join(repoRoot, 'ecos/layout-viewer/Cargo.toml'),
        packer,
        viewer,
      ],
    })

    await service.open({
      projectPath: '/project',
      viewJsonPackageRoot: packageRoot,
    })

    expect(execFile).toHaveBeenCalledWith(packer, [packageRoot, layoutPackagePath])
  })

  it('throws a build hint when dev binaries are missing', async () => {
    const { service } = createService({
      existingPaths: ['/repo/ecos/layout-viewer/Cargo.toml'],
    })

    await expect(
      service.open({
        projectPath: '/project',
        viewJsonPackageRoot: '/project/output/gcd_route_view',
      }),
    ).rejects.toThrow(
      'Build them with: cd ecos/layout-viewer && cargo build --release -p layout-viewer-native -p ecos-layout-packer',
    )
  })

  it('launches packaged binaries from electron resources', async () => {
    const packageRoot = '/project/output/gcd_route_view'
    const resourcesPath = '/opt/ECOS Studio/resources'
    const binaryDir = join(resourcesPath, 'binaries')
    const packer = join(binaryDir, 'ecos-layout-packer')
    const viewer = join(binaryDir, 'layout-viewer-native')
    const layoutPackagePath = join(packageRoot, '.layoutpkg')
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [
        packer,
        viewer,
      ],
      isPackaged: true,
      resourcesPath,
    })

    await service.open({
      projectPath: '/project',
      viewJsonPackageRoot: packageRoot,
      rebuildPackage: true,
    })

    expect(execFile).toHaveBeenCalledWith(packer, [packageRoot, layoutPackagePath])
    expect(spawnProcess).toHaveBeenCalledWith(
      viewer,
      [layoutPackagePath],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }),
    )
  })
})
