import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceStepInfoResult } from '@ecos-studio/shared'
import { ChipViewerService, type ChipViewerServiceOptions } from './chipViewerService'

interface ExecFileResult {
  stdout: string
  stderr: string
}

const REPO_ROOT = '/repo'
const PROJECT_ROOT = '/project'
const STEP_NAME = 'Floorplan'
const STEP_DIRECTORY = join(PROJECT_ROOT, 'Floorplan_ecc')
const DEF_PATH = join(STEP_DIRECTORY, 'output', 'gcd_Floorplan.def.gz')
const DB_PATH = join(STEP_DIRECTORY, 'output', 'gcd_Floorplan_db')
const GDS_PATH = join(STEP_DIRECTORY, 'output', 'gcd_Floorplan.gds')
const IMAGE_PATH = join(STEP_DIRECTORY, 'output', 'gcd_Floorplan.png')
const GEOMETRY_DIR = join(STEP_DIRECTORY, 'output', 'geometry')
const GEOMETRY_MANIFEST = join(GEOMETRY_DIR, 'geometry.manifest')
const GEOMETRY_EPOCH_DIR = join(GEOMETRY_DIR, 'epochs', '1')
const GEOMETRY_META = join(GEOMETRY_EPOCH_DIR, 'geometry.meta.bin')
const GEOMETRY_SHAPES = join(GEOMETRY_EPOCH_DIR, 'geometry.shapes.bin')
const GEOMETRY_OWNERS = join(GEOMETRY_EPOCH_DIR, 'geometry.owners.bin')
const GEOMETRY_PAYLOAD = join(GEOMETRY_EPOCH_DIR, 'geometry.payload.bin')
const GEOMETRY_NAMES = join(GEOMETRY_EPOCH_DIR, 'geometry.names.bin')
const GEOMETRY_NAME_INDEX = join(GEOMETRY_EPOCH_DIR, 'geometry.name_index.bin')
const GEOMETRY_SIDMAP = join(GEOMETRY_EPOCH_DIR, 'geometry.sidmap.bin')
const GEOMETRY_VIEW = join(GEOMETRY_EPOCH_DIR, 'geometry.view.bin')
const DRC_DATA_PATH = join(STEP_DIRECTORY, 'feature', 'drc.step.json')
const DRC_STATIS_PATH = join(STEP_DIRECTORY, 'analysis', 'drc_statis.csv')
const MAP_ROOT_PATH = join(STEP_DIRECTORY, 'feature')
const EDIT_ROOT_DIR = join(STEP_DIRECTORY, '.chip-viewer', 'layout-edit')
const EDIT_COMMAND_DIR = join(EDIT_ROOT_DIR, 'commands')
const EDIT_RESULT_DIR = join(EDIT_ROOT_DIR, 'results')
const EDIT_SESSION_ID = 'layout-edit-1'
const EDIT_BRIDGE_ID = 'bridge-1'
const EDIT_SESSION_COMMAND_DIR = join(EDIT_COMMAND_DIR, EDIT_SESSION_ID, EDIT_BRIDGE_ID)
const EDIT_SESSION_RESULT_DIR = join(EDIT_RESULT_DIR, EDIT_SESSION_ID, EDIT_BRIDGE_ID)
const DEFAULT_MANIFEST_FILE_PATHS = [
  GEOMETRY_META,
  GEOMETRY_SHAPES,
  GEOMETRY_OWNERS,
  GEOMETRY_PAYLOAD,
  GEOMETRY_NAMES,
  GEOMETRY_NAME_INDEX,
  GEOMETRY_SIDMAP,
  GEOMETRY_VIEW,
]

function geometryManifest(overrides: Record<string, string> = {}) {
  const entries = [
    ['schema_version', '1'],
    ['active_epoch', '1'],
    ['shape_count', '10'],
    ['owner_count', '10'],
    ['payload_size', '128'],
    ['meta', 'epochs/1/geometry.meta.bin'],
    ['shapes', 'epochs/1/geometry.shapes.bin'],
    ['owners', 'epochs/1/geometry.owners.bin'],
    ['payload', 'epochs/1/geometry.payload.bin'],
    ['names', 'epochs/1/geometry.names.bin'],
    ['name_index', 'epochs/1/geometry.name_index.bin'],
    ['sidmap', 'epochs/1/geometry.sidmap.bin'],
    ['view', 'epochs/1/geometry.view.bin'],
  ]
  const defaultKeys = new Set(entries.map(([key]) => key))
  const extraEntries = Object.entries(overrides).filter(([key]) => !defaultKeys.has(key))
  return entries
    .map(([key, defaultValue]) => `${key}=${overrides[key] ?? defaultValue}`)
    .concat(extraEntries.map(([key, value]) => `${key}=${value}`))
    .join('\n')
    .concat('\n')
}

function devChipViewerPaths() {
  return {
    cargoManifest: join(REPO_ROOT, 'ecos/chip-viewer/Cargo.toml'),
    ecc: join(REPO_ROOT, 'ecos/scripts/ecc-wrapper.sh'),
    viewer: join(REPO_ROOT, 'ecos/scripts/chip-viewer-native-wrapper.sh'),
  }
}

function createSpawnedViewerProcess() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    unref: () => void
  }
  child.pid = 123
  child.unref = vi.fn(() => undefined)
  return child
}

function createService(options: {
  appPath?: string
  closeLogFile?: (fd: number) => void
  cwd?: string
  env?: NodeJS.ProcessEnv
  execFile?: (file: string, args: string[]) => Promise<ExecFileResult>
  existingPaths?: string[]
  files?: Record<string, string>
  getFileModifiedTime?: (path: string) => Promise<number | null>
  includeDefaultDefPath?: boolean
  isPackaged?: boolean
  layoutEditRuntime?: NonNullable<ChipViewerServiceOptions['layoutEditRuntime']>
  modifiedTimes?: Record<string, number>
  openLogFile?: (path: string, flags: string) => number
  resourcesPath?: string
  spawnProcess?: ChipViewerServiceOptions['spawnProcess']
  stepInfoResult?: WorkspaceStepInfoResult
  viewerLogDirectory?: string
  viewerStartupCheckMs?: number
}) {
  const files = new Map(Object.entries(options.files ?? {}))
  const devPaths = devChipViewerPaths()
  const existingPaths = new Set([
    ...(options.includeDefaultDefPath === false ? [] : [DEF_PATH]),
    ...(options.isPackaged ? [] : [devPaths.ecc]),
    ...(options.existingPaths ?? []),
    ...files.keys(),
  ])
  if (existingPaths.has(GEOMETRY_MANIFEST) && !files.has(GEOMETRY_MANIFEST)) {
    files.set(GEOMETRY_MANIFEST, geometryManifest())
    for (const path of DEFAULT_MANIFEST_FILE_PATHS) {
      existingPaths.add(path)
    }
  }
  const modifiedTimes = new Map(Object.entries(options.modifiedTimes ?? {}))
  const execFile = options.execFile ?? vi.fn(async () => ({ stderr: '', stdout: '' }))
  const spawnedProcess = createSpawnedViewerProcess()
  const unref = spawnedProcess.unref
  const spawnProcess = options.spawnProcess ?? vi.fn(() => spawnedProcess)
  const ensureDirectory = vi.fn(async () => undefined)
  let nextLogFd = 10
  const openLogFile =
    options.openLogFile ??
    vi.fn(() => {
      nextLogFd += 1
      return nextLogFd
    })
  const closeLogFile = options.closeLogFile ?? vi.fn()
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
          db: DB_PATH,
          def: DEF_PATH,
          gds: GDS_PATH,
          image: IMAGE_PATH,
        },
        message: [],
        missing: [],
        response: 'available',
        step: STEP_NAME,
      }
      return result
    }),
  }
  const layoutEditRuntime = options.layoutEditRuntime ?? {
    layoutEditApply: vi.fn(async () => ({
      dirty: true,
      editSessionId: 'layout-edit-1',
      geometryDelta: {
        deletedShapeCount: 0,
        insertedShapeCount: 0,
        updatedShapeCount: 1,
      },
      geometryManifestPath: GEOMETRY_MANIFEST,
      geometryRevision: 1,
      revision: 1,
    })),
    layoutEditBegin: vi.fn(async () => ({
      dirty: false,
      editSessionId: 'layout-edit-1',
      geometryManifestPath: GEOMETRY_MANIFEST,
      geometryRevision: 0,
      revision: 0,
      sourceFingerprint: 'source-1',
    })),
    layoutEditDiscard: vi.fn(async () => ({
      discarded: true,
      dirty: true,
      editSessionId: 'layout-edit-1',
      geometryManifestPath: GEOMETRY_MANIFEST,
    })),
    layoutEditSave: vi.fn(async () => ({
      artifacts: {
        dbPath: DB_PATH,
        defPath: DEF_PATH,
        gdsPath: GDS_PATH,
        geometryManifestPath: GEOMETRY_MANIFEST,
      },
      dirty: false,
      editSessionId: 'layout-edit-1',
      geometryRevision: 1,
      revision: 1,
      saved: true,
    })),
    openWorkspace: vi.fn(async () => ({
      directory: PROJECT_ROOT,
      workspaceHandle: 'workspace-handle-1',
    })),
  }
  const service = new ChipViewerService({
    appPath: options.appPath ?? join(REPO_ROOT, 'ecos/gui/apps/desktop-electron'),
    closeLogFile,
    cwd: options.cwd ?? join(REPO_ROOT, 'ecos/gui/apps/desktop-electron'),
    env: options.env ?? { DISPLAY: ':99' },
    ensureDirectory,
    execFile,
    fileExists: (path) => existingPaths.has(path),
    getFileModifiedTime:
      options.getFileModifiedTime ??
      (async (path) => {
        const modifiedTime = modifiedTimes.get(path)
        if (modifiedTime !== undefined) return modifiedTime
        return existingPaths.has(path) ? 100 : null
      }),
    isPackaged: options.isPackaged ?? false,
    layoutEditRuntime,
    openLogFile,
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
    viewerLogDirectory: options.viewerLogDirectory ?? '/viewer-logs',
    viewerStartupCheckMs: options.viewerStartupCheckMs ?? 0,
    watchDirectory,
    writeTextFile,
    workspaceResourceService,
  })

  return {
    closeLogFile,
    ensureDirectory,
    execFile,
    openLogFile,
    service,
    layoutEditRuntime,
    spawnProcess,
    spawnedProcess,
    unref,
    renameFile,
    watchDirectory,
    writeTextFile,
    workspaceResourceService,
  }
}

describe('ChipViewerService', () => {
  it('tracks a launched viewer until its native process exits', async () => {
    const devBinaries = devChipViewerPaths()
    const { service, spawnedProcess } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {},
    })
    const request = { projectPath: PROJECT_ROOT, step: STEP_NAME }

    await expect(service.isOpen(request)).resolves.toEqual({ open: false })
    await service.open(request)
    await expect(service.isOpen(request)).resolves.toEqual({ open: true })

    spawnedProcess.emit('exit', 0, null)
    await expect(service.isOpen(request)).resolves.toEqual({ open: false })
  })

  it('rejects unsupported viewer modes before spawning the native process', async () => {
    const devBinaries = devChipViewerPaths()
    const { service, spawnProcess } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {},
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

  it('reports missing saved geometry without launching the native viewer', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer],
    })

    await expect(
      service.open({
        mode: 'edit',
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(
      `No saved layout data is available for ${STEP_NAME}: geometry manifest is missing. Run this step again to generate layout data before opening Chip Viewer.`,
    )
    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('restores the dirty state when reopening an ECC edit session', async () => {
    const devBinaries = devChipViewerPaths()
    const layoutEditBegin = vi.fn(async () => ({
      dirty: true,
      editSessionId: EDIT_SESSION_ID,
      geometryManifestPath: GEOMETRY_MANIFEST,
      geometryRevision: 1,
      revision: 1,
      sourceFingerprint: 'source-1',
    }))
    const { service, spawnProcess } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {},
      layoutEditRuntime: {
        layoutEditApply: vi.fn(),
        layoutEditBegin,
        layoutEditDiscard: vi.fn(),
        layoutEditSave: vi.fn(),
        openWorkspace: vi.fn(async () => ({
          directory: PROJECT_ROOT,
          workspaceHandle: 'workspace-handle-1',
        })),
      },
    })

    await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })

    expect(spawnProcess).toHaveBeenCalledWith(
      devBinaries.viewer,
      expect.arrayContaining(['--edit-dirty']),
      expect.any(Object),
    )
  })

  it('releases the ECC edit session when the viewer exits before opening another step', async () => {
    const devBinaries = devChipViewerPaths()
    const layoutEditBegin = vi
      .fn()
      .mockResolvedValueOnce({
        dirty: false,
        editSessionId: EDIT_SESSION_ID,
        geometryManifestPath: GEOMETRY_MANIFEST,
        geometryRevision: 0,
        revision: 0,
        sourceFingerprint: 'source-1',
      })
      .mockResolvedValueOnce({
        dirty: false,
        editSessionId: 'layout-edit-2',
        geometryManifestPath: GEOMETRY_MANIFEST,
        geometryRevision: 0,
        revision: 0,
        sourceFingerprint: 'source-2',
      })
    const layoutEditDiscard = vi.fn(async () => ({
      discarded: true,
      dirty: false,
      editSessionId: EDIT_SESSION_ID,
    }))
    const { layoutEditRuntime, service, spawnedProcess, watchDirectory } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {},
      layoutEditRuntime: {
        layoutEditApply: vi.fn(),
        layoutEditBegin,
        layoutEditDiscard,
        layoutEditSave: vi.fn(),
        openWorkspace: vi.fn(async () => ({
          directory: PROJECT_ROOT,
          workspaceHandle: 'workspace-handle-1',
        })),
      },
    })

    await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })
    spawnedProcess.emit('exit', 0, null)

    await vi.waitFor(() => {
      expect(layoutEditRuntime.layoutEditDiscard).toHaveBeenCalledWith({
        editSessionId: EDIT_SESSION_ID,
        workspaceHandle: 'workspace-handle-1',
      })
    })
    expect(watchDirectory.mock.results[0]?.value.close).toHaveBeenCalledTimes(1)

    await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: 'place',
    })

    expect(layoutEditBegin).toHaveBeenNthCalledWith(1, {
      step: STEP_NAME,
      workspaceHandle: 'workspace-handle-1',
    })
    expect(layoutEditBegin).toHaveBeenNthCalledWith(2, {
      step: 'place',
      workspaceHandle: 'workspace-handle-1',
    })
  })

  it('launches the native viewer with sanitized environment and diagnostic logs', async () => {
    const devBinaries = devChipViewerPaths()
    const { closeLogFile, openLogFile, service, spawnProcess } = createService({
      env: {
        DISPLAY: ':44',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: '--require /tmp/node-hook.js',
        PATH: '/usr/bin',
      },
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {},
    })

    await service.open({
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })

    const launchOptions = vi.mocked(spawnProcess).mock.calls[0]?.[2]
    expect(launchOptions?.env.DISPLAY).toBe(':44')
    expect(launchOptions?.env.PATH).toBe('/usr/bin')
    expect(launchOptions?.env.ELECTRON_NO_ATTACH_CONSOLE).toBeUndefined()
    expect(launchOptions?.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(launchOptions?.env.NODE_OPTIONS).toBeUndefined()
    expect(launchOptions?.stdio).toEqual(['ignore', 11, 12])
    expect(openLogFile).toHaveBeenCalledTimes(2)
    expect(closeLogFile).toHaveBeenCalledWith(11)
    expect(closeLogFile).toHaveBeenCalledWith(12)
  })

  it('passes DRC data files to the native viewer for the DRC step', async () => {
    const devBinaries = devChipViewerPaths()
    const { service, spawnProcess } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
        DRC_DATA_PATH,
        DRC_STATIS_PATH,
      ],
      files: {},
    })

    await service.open({
      projectPath: PROJECT_ROOT,
      step: 'drc',
    })

    expect(spawnProcess).toHaveBeenCalledWith(
      devBinaries.viewer,
      [
        '--manifest',
        GEOMETRY_MANIFEST,
        '--mode',
        'view',
        '--drc-data',
        DRC_DATA_PATH,
        '--drc-statis',
        DRC_STATIS_PATH,
      ],
      expect.objectContaining({
        detached: true,
        stdio: ['ignore', expect.any(Number), expect.any(Number)],
      }),
    )
  })

  it('passes DRC data files when the workspace step directory is drc_ecc', async () => {
    const devBinaries = devChipViewerPaths()
    const { service, spawnProcess } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
        DRC_DATA_PATH,
        DRC_STATIS_PATH,
      ],
      files: {},
      stepInfoResult: {
        id: 'layout',
        info: {
          db: DB_PATH,
          def: DEF_PATH,
          gds: GDS_PATH,
          image: IMAGE_PATH,
        },
        message: [],
        missing: [],
        response: 'available',
        step: 'DRC',
      },
    })

    await service.open({
      projectPath: PROJECT_ROOT,
      step: 'drc_ecc',
    })

    expect(spawnProcess).toHaveBeenCalledWith(
      devBinaries.viewer,
      [
        '--manifest',
        GEOMETRY_MANIFEST,
        '--mode',
        'view',
        '--drc-data',
        DRC_DATA_PATH,
        '--drc-statis',
        DRC_STATIS_PATH,
      ],
      expect.objectContaining({
        detached: true,
        stdio: ['ignore', expect.any(Number), expect.any(Number)],
      }),
    )
  })

  it('passes the current step feature directory when map data may be available', async () => {
    const devBinaries = devChipViewerPaths()
    const { service, spawnProcess } = createService({
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
        MAP_ROOT_PATH,
      ],
      files: {},
    })

    await service.open({
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })

    expect(spawnProcess).toHaveBeenCalledWith(
      devBinaries.viewer,
      ['--manifest', GEOMETRY_MANIFEST, '--mode', 'view', '--map-root', MAP_ROOT_PATH],
      expect.objectContaining({
        detached: true,
        stdio: ['ignore', expect.any(Number), expect.any(Number)],
      }),
    )
  })

  it('reports native viewer startup exits with the viewer log paths', async () => {
    const devBinaries = devChipViewerPaths()
    const child = createSpawnedViewerProcess()
    const spawnProcess = vi.fn(() => {
      setTimeout(() => {
        child.emit('exit', 1, null)
      }, 0)
      return child
    })
    const { layoutEditRuntime, service } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {},
      spawnProcess,
      viewerStartupCheckMs: 50,
    })

    let message = ''
    try {
      await service.open({
        mode: 'edit',
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      })
      throw new Error('expected viewer startup to fail')
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(
      'Chip viewer failed to launch: native viewer exited during startup',
    )
    expect(message).toContain(`Viewer binary: ${devBinaries.viewer}`)
    expect(message).toContain(`Manifest: ${GEOMETRY_MANIFEST}`)
    expect(message).toContain('stdout log: /viewer-logs/')
    expect(message).toContain('stderr log: /viewer-logs/')
    expect(child.unref).not.toHaveBeenCalled()
    expect(layoutEditRuntime.layoutEditDiscard).toHaveBeenCalledWith({
      editSessionId: EDIT_SESSION_ID,
      workspaceHandle: 'workspace-handle-1',
    })
  })

  it('reports a missing Linux display environment before spawning the viewer', async () => {
    const devBinaries = devChipViewerPaths()
    const { service, spawnProcess } = createService({
      env: {
        PATH: '/usr/bin',
      },
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {},
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      }),
    ).rejects.toThrow('no Linux display environment is available')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('launches an existing saved geometry manifest without invoking ECC', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
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

  it('rejects a saved geometry manifest with an unsupported schema', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {
        [GEOMETRY_MANIFEST]: geometryManifest({
          schema_version: '99',
        }),
      },
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(
      `No saved layout data is available for ${STEP_NAME}: manifest schema_version 99 is unsupported; expected 1. Run this step again to generate layout data before opening Chip Viewer.`,
    )
    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('rejects a saved geometry manifest with invalid dirty metrics', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {
        [GEOMETRY_MANIFEST]: geometryManifest({
          dirty_lod_tile_count: 'not-a-number',
        }),
      },
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(
      `No saved layout data is available for ${STEP_NAME}: manifest dirty_lod_tile_count is not a non-negative integer: not-a-number. Run this step again to generate layout data before opening Chip Viewer.`,
    )
    expect(execFile).not.toHaveBeenCalled()
  })

  it('rejects a saved geometry manifest with missing side files', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {
        [GEOMETRY_MANIFEST]: geometryManifest(),
      },
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(
      `No saved layout data is available for ${STEP_NAME}: manifest meta file does not exist: ${GEOMETRY_META}. Run this step again to generate layout data before opening Chip Viewer.`,
    )
    expect(execFile).not.toHaveBeenCalled()
  })

  it('rejects stale saved geometry when the source DEF is newer', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      modifiedTimes: {
        [DEF_PATH]: 300,
        [GEOMETRY_MANIFEST]: 250,
      },
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(
      `No saved layout data is available for ${STEP_NAME}: geometry manifest is older than DEF: ${DEF_PATH}. Run this step again to generate layout data before opening Chip Viewer.`,
    )
    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('bridges an instance move through the ECC edit session without publishing artifacts', async () => {
    const devBinaries = devChipViewerPaths()
    const commandPath = join(EDIT_SESSION_COMMAND_DIR, 'command-42.json')
    const resultPath = join(EDIT_SESSION_RESULT_DIR, 'result-42.json')
    const execFile = vi.fn(async (_file: string, _args: string[]) => ({
      stderr: '',
      stdout: '',
    }))
    const { layoutEditRuntime, renameFile, service, watchDirectory, writeTextFile } =
      createService({
        execFile,
        existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
        files: {
          [commandPath]: JSON.stringify({
            command_id: 42,
            expected_version: 3,
            instance_name: 'u_sram_0',
            op: 'move_shape',
            requested_bbox: { hx: 120, hy: 240, lx: 100, ly: 200 },
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
    expect(editListener).toBeDefined()

    editListener?.('command-42.json')

    await vi.waitFor(() => {
      expect(layoutEditRuntime.layoutEditApply).toHaveBeenCalledWith({
        baseRevision: 0,
        commandId: 'bridge-1:42',
        editSessionId: 'layout-edit-1',
        operation: {
          cellmaster: '',
          createIfMissing: false,
          instName: 'u_sram_0',
          kind: 'place_instance',
          llx: 100,
          lly: 200,
          orient: '',
          placementStatus: 'preserve',
          source: '',
        },
        workspaceHandle: 'workspace-handle-1',
      })
      expect(writeTextFile).toHaveBeenCalledWith(
        `${resultPath}.tmp`,
        expect.stringContaining('"geometry_manifest_path"'),
      )
      expect(renameFile).toHaveBeenCalledWith(`${resultPath}.tmp`, resultPath)
    })
    expect(
      execFile.mock.calls.some(([, args]) =>
        args.some((argument) =>
          ['--write-def', '--write-db', '--write-gds', 'apply-edit'].includes(argument),
        ),
      ),
    ).toBe(false)
  })

  it('rejects command IDs outside the JavaScript safe integer range', async () => {
    const devBinaries = devChipViewerPaths()
    const unsafeCommandId = Number.MAX_SAFE_INTEGER + 1
    const commandPath = join(EDIT_SESSION_COMMAND_DIR, `command-${unsafeCommandId}.json`)
    const resultPath = join(EDIT_SESSION_RESULT_DIR, `result-${unsafeCommandId}.json`)
    const { layoutEditRuntime, renameFile, service, watchDirectory, writeTextFile } =
      createService({
        existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
        files: {
          [commandPath]: JSON.stringify({
            command_id: unsafeCommandId,
            expected_version: 3,
            instance_name: 'u_sram_0',
            op: 'move_shape',
            requested_bbox: { hx: 120, hy: 240, lx: 100, ly: 200 },
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

    editListener?.(`command-${unsafeCommandId}.json`)

    await vi.waitFor(() => {
      expect(layoutEditRuntime.layoutEditApply).not.toHaveBeenCalled()
      expect(writeTextFile).toHaveBeenCalledWith(
        `${resultPath}.tmp`,
        expect.stringContaining('invalid native edit command field: command_id'),
      )
      expect(renameFile).toHaveBeenCalledWith(`${resultPath}.tmp`, resultPath)
    })
  })

  it('publishes through Save and refreshes the layout image only after session save', async () => {
    const devBinaries = devChipViewerPaths()
    const execFile = vi.fn(async () => ({
      stderr: '',
      stdout: '',
    }))
    const commandPath = join(EDIT_SESSION_COMMAND_DIR, 'control-save-43.json')
    const resultPath = join(EDIT_SESSION_RESULT_DIR, 'control-result-save-43.json')
    const progressPath = join(EDIT_SESSION_RESULT_DIR, 'control-progress-save-43.json')
    const {
      ensureDirectory,
      layoutEditRuntime,
      renameFile,
      service,
      watchDirectory,
      writeTextFile,
    } = createService({
      execFile,
      existingPaths: [
        devBinaries.cargoManifest,
        devBinaries.viewer,
        GEOMETRY_MANIFEST,
        DB_PATH,
        GDS_PATH,
      ],
      files: {
        [commandPath]: JSON.stringify({ action: 'save', command_id: 43 }),
      },
    })

    await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })
    const editListener = watchDirectory.mock.calls[0]?.[1]

    editListener?.('control-save-43.json')

    await vi.waitFor(() => {
      expect(layoutEditRuntime.layoutEditSave).toHaveBeenCalledWith({
        editSessionId: 'layout-edit-1',
        expectedRevision: 0,
        workspaceHandle: 'workspace-handle-1',
      })
      expect(ensureDirectory).toHaveBeenCalledWith(join(STEP_DIRECTORY, 'output'))
      expect(execFile).toHaveBeenCalledWith(devBinaries.ecc, [
        'layout-image',
        '--gds',
        GDS_PATH,
        '--image',
        IMAGE_PATH,
      ])
      expect(writeTextFile).toHaveBeenCalledWith(
        `${resultPath}.tmp`,
        expect.stringContaining('verified DEF, IDB, GDS, and geometry manifest'),
      )
      expect(writeTextFile).toHaveBeenCalledWith(
        `${progressPath}.tmp`,
        expect.stringContaining('"phase": "published"'),
      )
      expect(renameFile).toHaveBeenCalledWith(`${progressPath}.tmp`, progressPath)
      expect(renameFile).toHaveBeenCalledWith(`${resultPath}.tmp`, resultPath)
    })
  })

  it('rejects Save when ECC does not publish every persistent layout artifact', async () => {
    const devBinaries = devChipViewerPaths()
    const commandPath = join(EDIT_SESSION_COMMAND_DIR, 'control-save-44.json')
    const resultPath = join(EDIT_SESSION_RESULT_DIR, 'control-result-save-44.json')
    const progressPath = join(EDIT_SESSION_RESULT_DIR, 'control-progress-save-44.json')
    const execFile = vi.fn(async () => ({ stderr: '', stdout: '' }))
    const { layoutEditRuntime, renameFile, service, watchDirectory, writeTextFile } =
      createService({
        execFile,
        existingPaths: [
          devBinaries.cargoManifest,
          devBinaries.viewer,
          GEOMETRY_MANIFEST,
          GDS_PATH,
        ],
        files: {
          [commandPath]: JSON.stringify({ action: 'save', command_id: 44 }),
        },
      })

    await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })
    const editListener = watchDirectory.mock.calls[0]?.[1]

    editListener?.('control-save-44.json')

    await vi.waitFor(() => {
      expect(layoutEditRuntime.layoutEditSave).toHaveBeenCalledTimes(1)
      expect(writeTextFile).toHaveBeenCalledWith(
        `${resultPath}.tmp`,
        expect.stringContaining('layout save did not publish: IDB'),
      )
      expect(writeTextFile).toHaveBeenCalledWith(
        `${progressPath}.tmp`,
        expect.stringContaining('"phase": "failed"'),
      )
      expect(renameFile).toHaveBeenCalledWith(`${resultPath}.tmp`, resultPath)
    })
    expect(execFile).not.toHaveBeenCalledWith(
      devBinaries.ecc,
      expect.arrayContaining(['layout-image']),
    )
  })

  it('discards the session, then starts a clean session without publishing artifacts', async () => {
    const devBinaries = devChipViewerPaths()
    const commandPath = join(EDIT_SESSION_COMMAND_DIR, 'control-discard-44.json')
    const resultPath = join(EDIT_SESSION_RESULT_DIR, 'control-result-discard-44.json')
    const layoutEditBegin = vi
      .fn()
      .mockResolvedValueOnce({
        dirty: false,
        editSessionId: EDIT_SESSION_ID,
        geometryManifestPath: '/tmp/layout-edit-1/geometry.manifest',
        geometryRevision: 0,
        revision: 0,
        sourceFingerprint: 'source-1',
      })
      .mockResolvedValueOnce({
        dirty: false,
        editSessionId: EDIT_SESSION_ID,
        geometryManifestPath: '/tmp/layout-edit-2/geometry.manifest',
        geometryRevision: 0,
        revision: 0,
        sourceFingerprint: 'source-1',
      })
    const layoutEditDiscard = vi.fn(async () => ({
      discarded: true,
      dirty: true,
      editSessionId: EDIT_SESSION_ID,
    }))
    const execFile = vi.fn(async () => ({ stderr: '', stdout: '' }))
    const { layoutEditRuntime, renameFile, service, watchDirectory, writeTextFile } =
      createService({
        execFile,
        existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
        files: {
          [commandPath]: JSON.stringify({ action: 'discard', command_id: 44 }),
        },
        layoutEditRuntime: {
          layoutEditApply: vi.fn(),
          layoutEditBegin,
          layoutEditDiscard,
          layoutEditSave: vi.fn(),
          openWorkspace: vi.fn(async () => ({
            directory: PROJECT_ROOT,
            workspaceHandle: 'workspace-handle-1',
          })),
        },
      })

    await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })
    const editListener = watchDirectory.mock.calls[0]?.[1]

    editListener?.('control-discard-44.json')

    await vi.waitFor(() => {
      expect(layoutEditRuntime.layoutEditDiscard).toHaveBeenCalledWith({
        editSessionId: EDIT_SESSION_ID,
        workspaceHandle: 'workspace-handle-1',
      })
      expect(layoutEditRuntime.layoutEditBegin).toHaveBeenLastCalledWith({
        step: STEP_NAME,
        workspaceHandle: 'workspace-handle-1',
      })
      expect(writeTextFile).toHaveBeenCalledWith(
        `${resultPath}.tmp`,
        expect.stringContaining('/tmp/layout-edit-2/geometry.manifest'),
      )
      expect(renameFile).toHaveBeenCalledWith(`${resultPath}.tmp`, resultPath)
    })
    expect(execFile).not.toHaveBeenCalledWith(
      devBinaries.ecc,
      expect.arrayContaining(['layout-image']),
    )
  })

  it('uses a bridge-scoped directory and command id each time the editor opens', async () => {
    const devBinaries = devChipViewerPaths()
    const layoutEditBegin = vi
      .fn()
      .mockResolvedValueOnce({
        dirty: false,
        editSessionId: EDIT_SESSION_ID,
        geometryManifestPath: '/tmp/layout-edit-1/geometry.manifest',
        geometryRevision: 0,
        revision: 0,
        sourceFingerprint: 'source-1',
      })
      .mockResolvedValueOnce({
        dirty: false,
        editSessionId: 'layout-edit-2',
        geometryManifestPath: '/tmp/layout-edit-2/geometry.manifest',
        geometryRevision: 0,
        revision: 0,
        sourceFingerprint: 'source-1',
      })
    const { service, watchDirectory } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {},
      layoutEditRuntime: {
        layoutEditApply: vi.fn(),
        layoutEditBegin,
        layoutEditDiscard: vi.fn(),
        layoutEditSave: vi.fn(),
        openWorkspace: vi.fn(async () => ({
          directory: PROJECT_ROOT,
          workspaceHandle: 'workspace-handle-1',
        })),
      },
    })

    const first = await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })
    const second = await service.open({
      mode: 'edit',
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })

    expect(first.editCommandDirectory).toBe(EDIT_SESSION_COMMAND_DIR)
    expect(second.editCommandDirectory).toBe(
      join(EDIT_COMMAND_DIR, 'layout-edit-2', 'bridge-2'),
    )
    expect(watchDirectory.mock.calls.map(([path]) => path)).toEqual([
      EDIT_SESSION_COMMAND_DIR,
      join(EDIT_COMMAND_DIR, 'layout-edit-2', 'bridge-2'),
    ])
  })

  it('rejects resize commands before calling the placement RPC', async () => {
    const devBinaries = devChipViewerPaths()
    const commandPath = join(EDIT_SESSION_COMMAND_DIR, 'command-42.json')
    const resultPath = join(EDIT_SESSION_RESULT_DIR, 'result-42.json')
    const temporaryResultPath = `${resultPath}.tmp`
    const { layoutEditRuntime, renameFile, service, watchDirectory, writeTextFile } =
      createService({
        existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
        files: {
          [commandPath]: JSON.stringify({
            command_id: 42,
            expected_version: 3,
            instance_name: 'u_sram_0',
            op: 'resize_rect',
            requested_bbox: { hx: 120, hy: 240, lx: 100, ly: 200 },
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
      expect(layoutEditRuntime.layoutEditApply).not.toHaveBeenCalled()
      expect(writeTextFile).toHaveBeenCalledWith(
        temporaryResultPath,
        expect.stringContaining('"status": "rejected"'),
      )
      expect(renameFile).toHaveBeenCalledWith(temporaryResultPath, resultPath)
    })
  })

  it('rejects unavailable workspace step resources before launching the viewer', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer, GEOMETRY_MANIFEST],
      files: {},
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

  it('rejects a missing workspace DEF before opening the viewer', async () => {
    const devBinaries = devChipViewerPaths()
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [devBinaries.cargoManifest, devBinaries.viewer],
      includeDefaultDefPath: false,
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(`Workspace step DEF does not exist: ${DEF_PATH}`)
    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('launches packaged chip viewer binaries from electron resources', async () => {
    const resourcesPath = '/opt/ECOS Studio/resources'
    const binaryDir = join(resourcesPath, 'binaries')
    const ecc = join(binaryDir, 'ecc')
    const viewer = join(binaryDir, 'chip-viewer-native')
    const eccToolsPackageDir = join(binaryDir, '_internal', 'ecc_tools_bin')
    const eccToolsLibDir = join(eccToolsPackageDir, 'lib')
    const { execFile, service, spawnProcess } = createService({
      existingPaths: [ecc, viewer, eccToolsPackageDir, eccToolsLibDir, GEOMETRY_MANIFEST],
      isPackaged: true,
      resourcesPath,
    })

    await service.open({
      projectPath: PROJECT_ROOT,
      step: STEP_NAME,
    })

    expect(execFile).not.toHaveBeenCalled()
    expect(spawnProcess).toHaveBeenCalledWith(
      viewer,
      ['--manifest', GEOMETRY_MANIFEST, '--mode', 'view'],
      expect.objectContaining({
        detached: true,
        stdio: ['ignore', expect.any(Number), expect.any(Number)],
      }),
    )
  })

  it('reports missing packaged ecc-tools runtime payload before launching the viewer', async () => {
    const resourcesPath = '/opt/ECOS Studio/resources'
    const binaryDir = join(resourcesPath, 'binaries')
    const ecc = join(binaryDir, 'ecc')
    const viewer = join(binaryDir, 'chip-viewer-native')
    const eccToolsPackageDir = join(binaryDir, '_internal', 'ecc_tools_bin')
    const eccToolsLibDir = join(eccToolsPackageDir, 'lib')
    const { service, spawnProcess } = createService({
      env: {
        PATH: '',
      },
      existingPaths: [ecc, viewer, eccToolsPackageDir, GEOMETRY_MANIFEST],
      isPackaged: true,
      resourcesPath,
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
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
    const ecc = join(binaryDir, 'ecc')
    const viewer = join(binaryDir, 'chip-viewer-native')
    const { service } = createService({
      env: {
        PATH: '',
      },
      existingPaths: [GEOMETRY_MANIFEST],
      isPackaged: true,
      resourcesPath,
    })

    await expect(
      service.open({
        projectPath: PROJECT_ROOT,
        step: STEP_NAME,
      }),
    ).rejects.toThrow(
      `Packaged chip viewer binaries are incomplete. Missing: ${ecc}, ${viewer}`,
    )
  })
})
