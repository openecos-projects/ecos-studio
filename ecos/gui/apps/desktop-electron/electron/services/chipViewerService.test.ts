import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceStepInfoResult } from '@ecos-studio/shared'
import { ChipViewerService } from './chipViewerService'

interface ExecFileResult {
  stdout: string
  stderr: string
}

const REPO_ROOT = '/repo'
const PROJECT_ROOT = '/project'
const STEP_NAME = 'Floorplan'
const STEP_DIRECTORY = join(PROJECT_ROOT, 'Floorplan_ecc')
const DEF_PATH = join(STEP_DIRECTORY, 'output', 'gcd_Floorplan.def.gz')
const GEOMETRY_DIR = join(STEP_DIRECTORY, 'output', 'geometry')
const GEOMETRY_MANIFEST = join(GEOMETRY_DIR, 'geometry.manifest')
const EDIT_COMMAND_DIR = join(GEOMETRY_DIR, 'edit', 'commands')
const EDIT_RESULT_DIR = join(GEOMETRY_DIR, 'edit', 'results')
const DB_CONFIG_PATH = join(PROJECT_ROOT, 'config', 'db_default_config.json')
const TECH_LEF = '/pdk/prtech/tech.lef'
const LEF_A = '/pdk/std/a.lef'
const LEF_B = '/pdk/std/b.lef'

function dbConfig() {
  return JSON.stringify({
    INPUT: {
      lef_paths: [LEF_A, LEF_B],
      tech_lef_path: TECH_LEF,
    },
  })
}

function devChipViewerPaths() {
  return {
    cargoManifest: join(REPO_ROOT, 'ecos/chip-viewer/Cargo.toml'),
    snapshot: join(REPO_ROOT, 'ecos/scripts/ecc-geometry-snapshot-wrapper.sh'),
    viewer: join(REPO_ROOT, 'ecos/scripts/chip-viewer-native-wrapper.sh'),
  }
}

function createService(options: {
  appPath?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  execFile?: (file: string, args: string[]) => Promise<ExecFileResult>
  existingPaths?: string[]
  files?: Record<string, string>
  includeDefaultDefPath?: boolean
  includeDefaultGeometryInputPaths?: boolean
  isPackaged?: boolean
  modifiedTimes?: Record<string, number>
  resourcesPath?: string
  stepInfoResult?: WorkspaceStepInfoResult
}) {
  const files = new Map(Object.entries(options.files ?? {}))
  const existingPaths = new Set([
    ...(options.includeDefaultDefPath === false ? [] : [DEF_PATH]),
    ...(options.includeDefaultGeometryInputPaths === false
      ? []
      : [TECH_LEF, LEF_A, LEF_B]),
    ...(options.existingPaths ?? []),
    ...files.keys(),
  ])
  const modifiedTimes = new Map(Object.entries(options.modifiedTimes ?? {}))
  const execFile =
    options.execFile ??
    vi.fn(async (_file: string, args: string[]) => {
      if (args.includes('--mode') && args.includes('snapshot')) {
        existingPaths.add(GEOMETRY_MANIFEST)
      }
      return {
        stderr: '',
        stdout: '',
      }
    })
  const unref = vi.fn()
  const spawnProcess = vi.fn(() => ({ unref }))
  const ensureDirectory = vi.fn(async () => undefined)
  const watchDirectory = vi.fn(
    (_path: string, _listener: (fileName: string) => void) => ({
      close: vi.fn(),
    }),
  )
  const renameFile = vi.fn(async () => undefined)
  const writeTextFile = vi.fn(async () => undefined)
  const workspaceResourceService = {
    resolveStepInfo: vi.fn(async (request: { id: 'layout'; step: string }) => {
      const result: WorkspaceStepInfoResult = options.stepInfoResult ?? {
        id: request.id,
        info: {
          def: DEF_PATH,
        },
        message: [],
        missing: [],
        response: 'available',
        step: STEP_NAME,
      }
      return result
    }),
  }
  const service = new ChipViewerService({
    appPath: options.appPath ?? join(REPO_ROOT, 'ecos/gui/apps/desktop-electron'),
    cwd: options.cwd ?? join(REPO_ROOT, 'ecos/gui/apps/desktop-electron'),
    env: options.env ?? {},
    ensureDirectory,
    execFile,
    fileExists: (path) => existingPaths.has(path),
    getFileModifiedTime: async (path) => {
      const modifiedTime = modifiedTimes.get(path)
      if (modifiedTime !== undefined) return modifiedTime
      return existingPaths.has(path) ? 100 : null
    },
    isPackaged: options.isPackaged ?? false,
    platform: 'linux',
    readTextFile: async (path) => {
      const text = files.get(path)
      if (text === undefined) {
        throw new Error(`file not found: ${path}`)
      }
      return text
    },
    renameFile,
    resourcesPath: options.resourcesPath,
    spawnProcess,
    watchDirectory,
    writeTextFile,
    workspaceResourceService,
  })

  return {
    ensureDirectory,
    execFile,
    service,
    spawnProcess,
    unref,
    renameFile,
    watchDirectory,
    writeTextFile,
    workspaceResourceService,
  }
}

describe('ChipViewerService', () => {
  it('rejects unsupported viewer modes before spawning the native process', async () => {
    const devBinaries = devChipViewerPaths()
    const { service, spawnProcess } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
    })

    await expect(
      service.open({
        mode: 'inspect' as 'view',
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      }),
    ).rejects.toThrow('Unsupported chip viewer mode')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('builds a missing geometry snapshot and launches the dev native viewer', async () => {
    const devBinaries = devChipViewerPaths()
    const {
      ensureDirectory,
      execFile,
      service,
      spawnProcess,
      unref,
      watchDirectory,
      workspaceResourceService,
    } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
    })

    const result = await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })

    expect(workspaceResourceService.resolveStepInfo).toHaveBeenCalledWith({
      id: 'layout',
      step: STEP_NAME,
    })
    expect(execFile).toHaveBeenCalledWith(devBinaries.snapshot, [
      '--tech-lef',
      TECH_LEF,
      '--lef',
      LEF_A,
      '--lef',
      LEF_B,
      '--def',
      DEF_PATH,
      '--out',
      GEOMETRY_DIR,
      '--mode',
      'snapshot',
    ])
    expect(spawnProcess).toHaveBeenCalledWith(
      devBinaries.viewer,
      [
        '--manifest',
        GEOMETRY_MANIFEST,
        '--mode',
        'edit',
        '--edit-command-dir',
        EDIT_COMMAND_DIR,
        '--edit-result-dir',
        EDIT_RESULT_DIR,
      ],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }),
    )
    expect(ensureDirectory).toHaveBeenCalledWith(EDIT_COMMAND_DIR)
    expect(ensureDirectory).toHaveBeenCalledWith(EDIT_RESULT_DIR)
    expect(watchDirectory).toHaveBeenCalledWith(EDIT_COMMAND_DIR, expect.any(Function))
    expect(unref).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      editCommandDirectory: EDIT_COMMAND_DIR,
      editResultDirectory: EDIT_RESULT_DIR,
      geometryManifestPath: GEOMETRY_MANIFEST,
      spawned: true,
      workspaceStepDirectory: STEP_DIRECTORY,
    })
  })

  it('reuses an existing geometry manifest unless rebuild is requested', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
    })

    await service.open({
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })

    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).toHaveBeenCalledWith(
      devBinaries.viewer,
      ['--manifest', GEOMETRY_MANIFEST, '--mode', 'view'],
      expect.any(Object),
    )
  })

  it('regenerates an existing geometry snapshot when the source DEF is newer', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
      modifiedTimes: {
        [DB_CONFIG_PATH]: 200,
        [DEF_PATH]: 300,
        [GEOMETRY_MANIFEST]: 250,
      },
    })

    await service.open({
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })

    expect(execFile).toHaveBeenCalledWith(devBinaries.snapshot, [
      '--tech-lef',
      TECH_LEF,
      '--lef',
      LEF_A,
      '--lef',
      LEF_B,
      '--def',
      DEF_PATH,
      '--out',
      GEOMETRY_DIR,
      '--mode',
      'snapshot',
    ])
    expect(spawnProcess).toHaveBeenCalledWith(
      devBinaries.viewer,
      ['--manifest', GEOMETRY_MANIFEST, '--mode', 'view'],
      expect.any(Object),
    )
  })

  it('regenerates an existing geometry snapshot when a LEF input is newer', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
        TECH_LEF,
        LEF_A,
        LEF_B,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
      modifiedTimes: {
        [DB_CONFIG_PATH]: 200,
        [DEF_PATH]: 200,
        [GEOMETRY_MANIFEST]: 250,
        [TECH_LEF]: 200,
        [LEF_A]: 400,
        [LEF_B]: 200,
      },
    })

    await service.open({
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })

    expect(execFile).toHaveBeenCalledWith(devBinaries.snapshot, [
      '--tech-lef',
      TECH_LEF,
      '--lef',
      LEF_A,
      '--lef',
      LEF_B,
      '--def',
      DEF_PATH,
      '--out',
      GEOMETRY_DIR,
      '--mode',
      'snapshot',
    ])
  })

  it('bridges native edit command files through ecc geometry apply-edit', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, renameFile, service, watchDirectory } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
    })

    await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })
    const editListener = watchDirectory.mock.calls[0]?.[1]
    expect(editListener).toBeDefined()

    editListener?.('command-42.json')

    await vi.waitFor(() => {
      expect(execFile).toHaveBeenCalledWith(devBinaries.snapshot, [
        '--tech-lef',
        TECH_LEF,
        '--lef',
        LEF_A,
        '--lef',
        LEF_B,
        '--def',
        DEF_PATH,
        '--out',
        GEOMETRY_DIR,
        '--mode',
        'apply-edit',
        '--edit-command',
        join(EDIT_COMMAND_DIR, 'command-42.json'),
        '--edit-result',
        join(EDIT_RESULT_DIR, 'result-42.json.tmp'),
        '--write-def',
        DEF_PATH,
      ])
      expect(renameFile).toHaveBeenCalledWith(
        join(EDIT_RESULT_DIR, 'result-42.json.tmp'),
        join(EDIT_RESULT_DIR, 'result-42.json'),
      )
    })
  })

  it('publishes rejected edit results atomically when apply-edit fails', async () => {
    const devBinaries = devChipViewerPaths()
    const commandPath = join(EDIT_COMMAND_DIR, 'command-42.json')
    const resultPath = join(EDIT_RESULT_DIR, 'result-42.json')
    const temporaryResultPath = `${resultPath}.tmp`
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes('apply-edit')) {
        throw new Error('apply-edit failed')
      }
      return {
        stderr: '',
        stdout: '',
      }
    })
    const { renameFile, service, watchDirectory, writeTextFile } = createService({
      execFile,
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
        [commandPath]: JSON.stringify({
          command_id: 42,
          shape_id: 99,
        }),
      },
    })

    await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })
    const editListener = watchDirectory.mock.calls[0]?.[1]

    editListener?.('command-42.json')

    await vi.waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledWith(
        temporaryResultPath,
        expect.stringContaining('"status": "rejected"'),
      )
      expect(renameFile).toHaveBeenCalledWith(temporaryResultPath, resultPath)
    })
  })

  it('throws a clear error when the db config has no LEF inputs', async () => {
    const devBinaries = devChipViewerPaths()
    const { service } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
      ],
      files: {
        [DB_CONFIG_PATH]: JSON.stringify({ INPUT: {} }),
      },
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        rebuildGeometry: true,
        step: STEP_NAME,
      }),
    ).rejects.toThrow('Geometry snapshot requires tech LEF and LEF paths')
  })

  it('throws a clear error when the geometry DB config file is missing', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
      ],
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        rebuildGeometry: true,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(`Geometry DB config does not exist: ${DB_CONFIG_PATH}`)
    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('throws a clear error when a configured LEF input is missing', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
        TECH_LEF,
        LEF_B,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
      includeDefaultGeometryInputPaths: false,
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        rebuildGeometry: true,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(`Geometry snapshot LEF does not exist: ${LEF_A}`)
    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('rejects unavailable workspace step resources before launching the viewer', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
      stepInfoResult: {
        id: 'layout',
        info: {
          def: DEF_PATH,
        },
        message: ['Layout step output is incomplete'],
        missing: [DEF_PATH],
        response: 'missing',
        step: STEP_NAME,
      },
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      }),
    ).rejects.toThrow('Workspace step Floorplan layout resources are missing')
    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('rejects a missing workspace DEF before generating geometry', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
      includeDefaultDefPath: false,
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        rebuildGeometry: true,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(`Workspace step DEF does not exist: ${DEF_PATH}`)
    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('reports snapshot subprocess stderr when generating a missing snapshot fails', async () => {
    const devBinaries = devChipViewerPaths()
    const execFile = vi.fn(async () => {
      throw Object.assign(new Error('snapshot exited with status 1'), {
        code: 1,
        stderr: 'failed to read LEF /pdk/std/a.lef',
        stdout: 'loading technology',
      })
    })
    const { service, spawnProcess } = createService({
      execFile,
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
    })

    let message = ''
    try {
      await service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      })
      throw new Error('expected snapshot generation to fail')
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(
      `Geometry snapshot generation failed while creating missing snapshot for step ${STEP_NAME}.`,
    )
    expect(message).toContain(`Snapshot binary: ${devBinaries.snapshot}`)
    expect(message).toContain(`DEF: ${DEF_PATH}`)
    expect(message).toContain(`Output: ${GEOMETRY_DIR}`)
    expect(message).toContain('stderr: failed to read LEF /pdk/std/a.lef')
    expect(message).toContain('stdout: loading technology')
    expect(message).toContain('exit code: 1')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('reports a missing manifest when snapshot generation exits successfully without output', async () => {
    const devBinaries = devChipViewerPaths()
    const execFile = vi.fn(async () => ({
      stderr: '',
      stdout: 'completed without writing files',
    }))
    const { service, spawnProcess } = createService({
      execFile,
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
    })

    let message = ''
    try {
      await service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      })
      throw new Error('expected missing manifest to fail')
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(
      `Snapshot command completed but did not create manifest: ${GEOMETRY_MANIFEST}`,
    )
    expect(message).toContain('stdout: completed without writing files')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('reports the stale source when snapshot regeneration fails', async () => {
    const devBinaries = devChipViewerPaths()
    const execFile = vi.fn(async () => {
      throw Object.assign(new Error('snapshot rebuild failed'), {
        stderr: 'DEF/LEF mismatch',
      })
    })
    const { service, spawnProcess } = createService({
      execFile,
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.snapshot,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
      ],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
      modifiedTimes: {
        [GEOMETRY_MANIFEST]: 250,
        [LEF_A]: 400,
      },
    })

    let message = ''
    try {
      await service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      })
      throw new Error('expected stale snapshot regeneration to fail')
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(
      `Geometry snapshot generation failed while rebuilding stale snapshot; stale source: LEF ${LEF_A} for step ${STEP_NAME}.`,
    )
    expect(message).toContain('stderr: DEF/LEF mismatch')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('launches packaged chip viewer binaries from electron resources', async () => {
    const resourcesPath = '/opt/ECOS Studio/resources'
    const binaryDir = join(resourcesPath, 'binaries')
    const snapshot = join(binaryDir, 'ecc-geometry-snapshot')
    const viewer = join(binaryDir, 'chip-viewer-native')
    const eccToolsPackageDir = join(binaryDir, '_internal', 'ecc_tools_bin')
    const eccToolsLibDir = join(eccToolsPackageDir, 'lib')
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [snapshot, viewer, eccToolsPackageDir, eccToolsLibDir],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
      isPackaged: true,
      resourcesPath,
    })

    await service.open({
      projectPath: PROJECT_ROOT,
      rebuildGeometry: true,
      step: STEP_NAME,
    })

    expect(execFile).toHaveBeenCalledWith(snapshot, [
      '--tech-lef',
      TECH_LEF,
      '--lef',
      LEF_A,
      '--lef',
      LEF_B,
      '--def',
      DEF_PATH,
      '--out',
      GEOMETRY_DIR,
      '--mode',
      'snapshot',
    ])
    expect(spawnProcess).toHaveBeenCalledWith(
      viewer,
      ['--manifest', GEOMETRY_MANIFEST, '--mode', 'view'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }),
    )
  })

  it('reports missing packaged ecc-tools runtime payload before launching the viewer', async () => {
    const resourcesPath = '/opt/ECOS Studio/resources'
    const binaryDir = join(resourcesPath, 'binaries')
    const snapshot = join(binaryDir, 'ecc-geometry-snapshot')
    const viewer = join(binaryDir, 'chip-viewer-native')
    const eccToolsPackageDir = join(binaryDir, '_internal', 'ecc_tools_bin')
    const eccToolsLibDir = join(eccToolsPackageDir, 'lib')
    const { service, spawnProcess } = createService({
      env: {
        PATH: '',
      },
      existingPaths: [snapshot, viewer, eccToolsPackageDir],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
      isPackaged: true,
      resourcesPath,
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        rebuildGeometry: true,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(
      `Packaged chip viewer binaries are incomplete. Missing: ${eccToolsLibDir}`,
    )
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('reports missing packaged chip viewer binaries before PATH fallback details', async () => {
    const resourcesPath = '/opt/ECOS Studio/resources'
    const binaryDir = join(resourcesPath, 'binaries')
    const snapshot = join(binaryDir, 'ecc-geometry-snapshot')
    const viewer = join(binaryDir, 'chip-viewer-native')
    const { service } = createService({
      env: {
        PATH: '',
      },
      existingPaths: [],
      files: {
        [DB_CONFIG_PATH]: dbConfig(),
      },
      isPackaged: true,
      resourcesPath,
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        rebuildGeometry: true,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(
      `Packaged chip viewer binaries are incomplete. Missing: ${snapshot}, ${viewer}`,
    )
  })
})
