import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createEccRuntimeEnv } from './eccRpc/runtimeEnv'
import { ChipViewerService } from './chipViewerService'
import { LayoutViewerService } from './layoutViewerService'

describe('development wrappers', () => {
  it('uses wrapper scripts for ECC and the layout viewer in development', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ecos-studio-dev-wrappers-'))
    const appPath = join(repoRoot, 'ecos', 'gui', 'apps', 'desktop-electron')
    const userDataPath = join(repoRoot, 'user-data')
    const scriptsPath = join(repoRoot, 'ecos', 'scripts')
    const chipViewerPath = join(repoRoot, 'ecos', 'chip-viewer')
    const layoutViewerPath = join(repoRoot, 'ecos', 'layout-viewer')
    const eccWrapperPath = join(scriptsPath, 'ecc-wrapper.sh')
    const chipViewerWrapperPath = join(scriptsPath, 'chip-viewer-native-wrapper.sh')
    const geometrySnapshotWrapperPath = join(
      scriptsPath,
      'ecc-geometry-snapshot-wrapper.sh',
    )
    const layoutPackerWrapperPath = join(scriptsPath, 'ecos-layout-packer-wrapper.sh')
    const layoutViewerWrapperPath = join(scriptsPath, 'layout-viewer-native-wrapper.sh')

    mkdirSync(join(repoRoot, 'ecc'), { recursive: true })
    mkdirSync(appPath, { recursive: true })
    mkdirSync(userDataPath, { recursive: true })
    mkdirSync(scriptsPath, { recursive: true })
    mkdirSync(chipViewerPath, { recursive: true })
    mkdirSync(layoutViewerPath, { recursive: true })
    writeFileSync(join(repoRoot, 'ecc', 'pyproject.toml'), '[project]\nname = "ecc"\n')
    writeFileSync(join(chipViewerPath, 'Cargo.toml'), '[workspace]\n')
    writeFileSync(join(layoutViewerPath, 'Cargo.toml'), '[workspace]\n')
    writeFileSync(eccWrapperPath, '#!/usr/bin/env bash\n')
    writeFileSync(chipViewerWrapperPath, '#!/usr/bin/env bash\n')
    writeFileSync(geometrySnapshotWrapperPath, '#!/usr/bin/env bash\n')
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

    const chipExecFile = vi.fn(async () => ({ stderr: '', stdout: '' }))
    const chipUnref = vi.fn()
    const chipSpawnProcess = vi.fn(() => ({ unref: chipUnref }))
    const chipDefPath = '/project/Floorplan_ecc/output/gcd_Floorplan.def.gz'
    const chipDbConfigPath = '/project/config/db_default_config.json'
    const chipTechLefPath = '/pdk/tech.lef'
    const chipLefPath = '/pdk/std.lef'
    const chipService = new ChipViewerService({
      appPath,
      cwd: appPath,
      env: {},
      execFile: chipExecFile,
      fileExists: (path) =>
        [chipDefPath, chipDbConfigPath, chipTechLefPath, chipLefPath].includes(path) ||
        existsSync(path),
      isPackaged: false,
      platform: 'linux',
      readTextFile: async () =>
        JSON.stringify({
          INPUT: {
            lef_paths: [chipLefPath],
            tech_lef_path: chipTechLefPath,
          },
        }),
      spawnProcess: chipSpawnProcess,
      workspaceResourceService: {
        resolveStepInfo: async (request) => ({
          id: request.id,
          info: {
            def: chipDefPath,
          },
          message: [],
          missing: [],
          response: 'available',
          step: request.step,
        }),
      },
    })

    await chipService.open({
      projectPath: '/project',
      rebuildGeometry: true,
      step: 'Floorplan',
    })

    expect(chipExecFile).toHaveBeenCalledWith(
      geometrySnapshotWrapperPath,
      expect.arrayContaining(['--tech-lef', chipTechLefPath, '--def', chipDefPath]),
    )
    expect(chipSpawnProcess).toHaveBeenCalledWith(
      chipViewerWrapperPath,
      [
        '--manifest',
        '/project/Floorplan_ecc/output/geometry/geometry.manifest',
        '--mode',
        'view',
      ],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }),
    )
    expect(chipUnref).toHaveBeenCalledTimes(1)
  })
})
