import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LayoutViewerService } from './layoutViewerService'

function createService(options: {
  appPath?: string
  cwd?: string
  existingPaths?: string[]
  isPackaged?: boolean
  resourcesPath?: string
}) {
  const execFile = vi.fn(async () => {})
  const unref = vi.fn()
  const spawnProcess = vi.fn(() => ({ unref }))
  const existingPaths = new Set(options.existingPaths ?? [])
  const service = new LayoutViewerService({
    appPath: options.appPath ?? '/repo/ecos/gui/apps/desktop-electron',
    cwd: options.cwd ?? '/repo/ecos/gui/apps/desktop-electron',
    env: {},
    execFile,
    fileExists: (path) => existingPaths.has(path),
    isPackaged: options.isPackaged ?? false,
    platform: 'linux',
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
    const viewer = join(releaseDir, 'layout-viewer-native-v2')
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

  it('reuses an existing .layoutpkg manifest unless rebuildPackage is requested', async () => {
    const packageRoot = '/project/output/gcd_route_view'
    const repoRoot = '/repo'
    const debugDir = join(repoRoot, 'ecos/layout-viewer/target/debug')
    const packer = join(debugDir, 'ecos-layout-packer')
    const viewer = join(debugDir, 'layout-viewer-native-v2')
    const layoutPackagePath = join(packageRoot, '.layoutpkg')
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [
        join(repoRoot, 'ecos/layout-viewer/Cargo.toml'),
        join(layoutPackagePath, 'manifest.json'),
        packer,
        viewer,
      ],
    })

    await service.open({
      projectPath: '/project',
      viewJsonPackageRoot: packageRoot,
    })

    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).toHaveBeenCalledWith(
      viewer,
      [layoutPackagePath],
      expect.any(Object),
    )
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
      'Build them with: cd ecos/layout-viewer && cargo build --release -p layout-viewer-native-v2 -p ecos-layout-packer',
    )
  })

  it('launches packaged binaries from electron resources', async () => {
    const packageRoot = '/project/output/gcd_route_view'
    const resourcesPath = '/opt/ECOS Studio/resources'
    const binaryDir = join(resourcesPath, 'binaries')
    const packer = join(binaryDir, 'ecos-layout-packer')
    const viewer = join(binaryDir, 'layout-viewer-native-v2')
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
