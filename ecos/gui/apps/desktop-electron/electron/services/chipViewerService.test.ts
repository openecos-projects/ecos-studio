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
  isPackaged?: boolean
  resourcesPath?: string
}) {
  const files = new Map(Object.entries(options.files ?? {}))
  const existingPaths = new Set([...(options.existingPaths ?? []), ...files.keys()])
  const execFile =
    options.execFile ??
    vi.fn(async () => ({
      stderr: '',
      stdout: '',
    }))
  const unref = vi.fn()
  const spawnProcess = vi.fn(() => ({ unref }))
  const ensureDirectory = vi.fn(async () => undefined)
  const watchDirectory = vi.fn(
    (_path: string, _listener: (fileName: string) => void) => ({
      close: vi.fn(),
    }),
  )
  const writeTextFile = vi.fn(async () => undefined)
  const workspaceResourceService = {
    resolveStepInfo: vi.fn(async (request: { id: 'layout'; step: string }) => {
      const result: WorkspaceStepInfoResult = {
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
    watchDirectory,
    writeTextFile,
    workspaceResourceService,
  }
}

describe('ChipViewerService', () => {
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

  it('bridges native edit command files through ecc geometry apply-edit', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, watchDirectory } = createService({
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
        join(EDIT_RESULT_DIR, 'result-42.json'),
        '--write-def',
        DEF_PATH,
      ])
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
})
