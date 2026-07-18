import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createEccRuntimeEnv } from './eccRpc/runtimeEnv'
import { ChipViewerService } from './chipViewerService'

describe('development wrappers', () => {
  it('uses wrapper scripts for ECC and the chip viewer in development', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ecos-studio-dev-wrappers-'))
    const appPath = join(repoRoot, 'ecos', 'gui', 'apps', 'desktop-electron')
    const userDataPath = join(repoRoot, 'user-data')
    const scriptsPath = join(repoRoot, 'ecos', 'scripts')
    const chipViewerPath = join(repoRoot, 'ecos', 'chip-viewer')
    const eccWrapperPath = join(scriptsPath, 'ecc-wrapper.sh')
    const chipViewerWrapperPath = join(scriptsPath, 'chip-viewer-native-wrapper.sh')
    const geometrySnapshotWrapperPath = join(
      scriptsPath,
      'ecc-geometry-snapshot-wrapper.sh',
    )

    mkdirSync(join(repoRoot, 'ecc'), { recursive: true })
    mkdirSync(appPath, { recursive: true })
    mkdirSync(userDataPath, { recursive: true })
    mkdirSync(scriptsPath, { recursive: true })
    mkdirSync(chipViewerPath, { recursive: true })
    writeFileSync(join(repoRoot, 'ecc', 'pyproject.toml'), '[project]\nname = "ecc"\n')
    writeFileSync(join(chipViewerPath, 'Cargo.toml'), '[workspace]\n')
    writeFileSync(eccWrapperPath, '#!/usr/bin/env bash\n')
    writeFileSync(chipViewerWrapperPath, '#!/usr/bin/env bash\n')
    writeFileSync(geometrySnapshotWrapperPath, '#!/usr/bin/env bash\n')

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

    let chipManifestWritten = false
    const chipExecFile = vi.fn(async () => {
      chipManifestWritten = true
      return { stderr: '', stdout: '' }
    })
    const chipViewerChild = new EventEmitter() as EventEmitter & {
      unref: () => void
    }
    const chipUnref = vi.fn(() => undefined)
    chipViewerChild.unref = chipUnref
    const chipSpawnProcess = vi.fn(() => chipViewerChild)
    const chipDefPath = '/project/Floorplan_ecc/output/gcd_Floorplan.def.gz'
    const chipDbPath = '/project/Floorplan_ecc/output/gcd_Floorplan_db'
    const chipGdsPath = '/project/Floorplan_ecc/output/gcd_Floorplan.gds'
    const chipImagePath = '/project/Floorplan_ecc/output/gcd_Floorplan.png'
    const chipManifestPath = '/project/Floorplan_ecc/output/geometry/geometry.manifest'
    const chipGeometryEpochDir = '/project/Floorplan_ecc/output/geometry/epochs/1'
    const chipGeometryFiles = [
      `${chipGeometryEpochDir}/geometry.meta.bin`,
      `${chipGeometryEpochDir}/geometry.shapes.bin`,
      `${chipGeometryEpochDir}/geometry.owners.bin`,
      `${chipGeometryEpochDir}/geometry.payload.bin`,
      `${chipGeometryEpochDir}/geometry.names.bin`,
      `${chipGeometryEpochDir}/geometry.name_index.bin`,
      `${chipGeometryEpochDir}/geometry.sidmap.bin`,
      `${chipGeometryEpochDir}/geometry.view.bin`,
    ]
    const chipGeometryManifest = [
      'schema_version=1',
      'active_epoch=1',
      'shape_count=1',
      'owner_count=1',
      'payload_size=1',
      'meta=epochs/1/geometry.meta.bin',
      'shapes=epochs/1/geometry.shapes.bin',
      'owners=epochs/1/geometry.owners.bin',
      'payload=epochs/1/geometry.payload.bin',
      'names=epochs/1/geometry.names.bin',
      'name_index=epochs/1/geometry.name_index.bin',
      'sidmap=epochs/1/geometry.sidmap.bin',
      'view=epochs/1/geometry.view.bin',
      '',
    ].join('\n')
    const chipDbConfigPath = '/project/config/db_default_config.json'
    const chipTechLefPath = '/pdk/tech.lef'
    const chipLefPath = '/pdk/std.lef'
    const chipService = new ChipViewerService({
      appPath,
      closeLogFile: vi.fn(),
      cwd: appPath,
      env: {
        DISPLAY: ':99',
      },
      execFile: chipExecFile,
      fileExists: (path) =>
        [chipDefPath, chipDbConfigPath, chipTechLefPath, chipLefPath].includes(path) ||
        (chipManifestWritten && path === chipManifestPath) ||
        (chipManifestWritten && chipGeometryFiles.includes(path)) ||
        existsSync(path),
      isPackaged: false,
      openLogFile: vi.fn(() => 11),
      platform: 'linux',
      readTextFile: async (path) => {
        if (path === chipManifestPath) {
          return chipGeometryManifest
        }
        return JSON.stringify({
          INPUT: {
            lef_paths: [chipLefPath],
            tech_lef_path: chipTechLefPath,
          },
        })
      },
      spawnProcess: chipSpawnProcess,
      viewerLogDirectory: join(userDataPath, 'logs', 'chip-viewer'),
      viewerStartupCheckMs: 0,
      workspaceResourceService: {
        resolveStepInfo: async (request) => ({
          id: request.id,
          info: {
            db: chipDbPath,
            def: chipDefPath,
            gds: chipGdsPath,
            image: chipImagePath,
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
      ['--manifest', chipManifestPath, '--mode', 'view'],
      expect.objectContaining({
        detached: true,
        stdio: ['ignore', expect.any(Number), expect.any(Number)],
      }),
    )
    expect(chipUnref).toHaveBeenCalledTimes(1)
  })
})
