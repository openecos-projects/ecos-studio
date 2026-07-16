import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createEccRuntimeEnv } from './eccRpc/runtimeEnv'
import { LayoutViewerService } from './layoutViewerService'

describe('development wrappers', () => {
  it('uses wrapper scripts for ECC and the layout viewer in development', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ecos-studio-dev-wrappers-'))
    const appPath = join(repoRoot, 'ecos', 'gui', 'apps', 'desktop-electron')
    const userDataPath = join(repoRoot, 'user-data')
    const scriptsPath = join(repoRoot, 'ecos', 'scripts')
    const layoutViewerPath = join(repoRoot, 'ecos', 'layout-viewer')
    const eccWrapperPath = join(scriptsPath, 'ecc-wrapper.sh')
    const layoutPackerWrapperPath = join(scriptsPath, 'ecos-layout-packer-wrapper.sh')
    const layoutViewerWrapperPath = join(scriptsPath, 'layout-viewer-native-wrapper.sh')

    mkdirSync(join(repoRoot, 'ecc'), { recursive: true })
    mkdirSync(appPath, { recursive: true })
    mkdirSync(userDataPath, { recursive: true })
    mkdirSync(scriptsPath, { recursive: true })
    mkdirSync(layoutViewerPath, { recursive: true })
    writeFileSync(join(repoRoot, 'ecc', 'pyproject.toml'), '[project]\nname = "ecc"\n')
    writeFileSync(join(layoutViewerPath, 'Cargo.toml'), '[workspace]\n')
    writeFileSync(eccWrapperPath, '#!/usr/bin/env bash\n')
    writeFileSync(layoutPackerWrapperPath, '#!/usr/bin/env bash\n')
    writeFileSync(layoutViewerWrapperPath, '#!/usr/bin/env bash\n')

    const env = createEccRuntimeEnv({
      appPath,
      cwd: appPath,
      env: {
        PATH: '/usr/bin',
      },
      isPackaged: false,
      platform: 'linux',
      userDataPath,
    })

    const runtimeBin = join(userDataPath, 'runtime-bin')
    const eccShimPath = join(runtimeBin, 'ecc')
    expect(env.PATH).toBe(`${runtimeBin}:/usr/bin`)
    expect(readFileSync(eccShimPath, 'utf8')).toContain(`exec "${eccWrapperPath}" "$@"`)

    const execFile = vi.fn(async () => ({ stderr: '', stdout: '' }))
    const unref = vi.fn()
    const spawnProcess = vi.fn(() => ({ unref }))
    const service = new LayoutViewerService({
      appPath,
      cwd: appPath,
      env: {},
      execFile,
      fileExists: existsSync,
      isPackaged: false,
      platform: 'linux',
      spawnProcess,
    })
    const packageRoot = '/project/output/gcd_route_view'
    const layoutPackagePath = join(packageRoot, '.layoutpkg')

    await service.open({
      projectPath: '/project',
      rebuildPackage: true,
      viewJsonPackageRoot: packageRoot,
    })

    expect(execFile).toHaveBeenCalledWith(layoutPackerWrapperPath, [
      packageRoot,
      layoutPackagePath,
    ])
    expect(spawnProcess).toHaveBeenCalledWith(
      layoutViewerWrapperPath,
      [layoutPackagePath],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }),
    )
    expect(unref).toHaveBeenCalledTimes(1)
  })
})
