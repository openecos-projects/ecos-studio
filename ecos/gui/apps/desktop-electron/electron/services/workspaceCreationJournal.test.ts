import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceCreationJournal } from './workspaceCreationJournal'
import type { WorkspaceRegistrationEvidence } from './projectManifestService'

const roots: string[] = []

async function journal(
  isWorkspace: (path: string) => Promise<boolean> = vi.fn(async () => false),
  inspectWorkspaceIdentity: (
    path: string,
  ) => Promise<{ workspaceId?: string; workspaceRevision?: number }> = vi.fn(
    async () => ({}),
  ),
) {
  const root = await mkdtemp(join(tmpdir(), 'ecos-creation-journal-'))
  roots.push(root)
  const settings = new Map<string, unknown>()
  let registration: WorkspaceRegistrationEvidence | null = null
  const projectManifestService = {
    ensureWorkspaceRegistration: vi.fn(async (_projectRoot, workspacePath) => {
      registration ??= evidence(workspacePath)
      return registration
    }),
    inspectWorkspaceRegistration: vi.fn(async () => registration),
    removeWorkspaceRegistration: vi.fn(async (_projectRoot, current) => {
      if (registration?.fingerprint !== current.fingerprint) {
        throw new Error('Registration changed.')
      }
      registration = null
    }),
  }
  const settingsStore = {
    get: vi.fn(async (key: string) => settings.get(key) ?? null) as never,
    set: vi.fn(async (key: string, value: unknown) => {
      settings.set(key, value)
    }) as never,
  }
  return {
    projectManifestService,
    root,
    service: new WorkspaceCreationJournal({
      canonicalizePaths: async (projectRoot, targetDirectory) => ({
        projectRoot,
        targetDirectory,
      }),
      directory: root,
      inspectWorkspaceIdentity,
      isWorkspace,
      projectManifestService,
      settingsStore,
    }),
    setRegistration: (value: WorkspaceRegistrationEvidence | null) => {
      registration = value
    },
    settings,
    settingsStore,
  }
}

function evidence(workspacePath: string): WorkspaceRegistrationEvidence {
  return {
    fingerprint: JSON.stringify({ workspace_id: 'ws_1', workspace_path: workspacePath }),
    projectId: 'project-1',
    workspaceId: 'ws_1',
    workspacePath,
  }
}

function recentWorkspace(targetDirectory: string) {
  return {
    designTool: 'backend',
    id: targetDirectory,
    lastOpened: '2026-09-04T00:00:00.000Z',
    name: 'ws_1',
    path: targetDirectory,
  }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

describe('WorkspaceCreationJournal', () => {
  it('writes authorized intent atomically and removes it only after completion', async () => {
    const { root, service, setRegistration, settings } = await journal()
    const targetDirectory = join(root, 'project', 'ws_1')
    const record = await service.begin(7, {
      commandId: 'command-1',
      projectId: 'project-1',
      projectRoot: join(root, 'project'),
      targetDirectory,
      workspaceBindings: { inputs: {} },
      workspaceSpec: { design: { name: 'gcd' } },
    })

    expect(await service.entriesForWindow(7)).toEqual([
      expect.objectContaining({
        creationId: record.creationId,
        ownerWindowId: 7,
        stage: 'intent-recorded',
        status: 'active',
        targetDirectory,
      }),
    ])
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    const stored = JSON.parse(
      await readFile(join(root, `${record.creationId}.json`), 'utf8'),
    )
    expect(stored.intent.workspaceSpec).toEqual({ design: { name: 'gcd' } })

    await service.markWorkspaceCreated(
      record.creationId,
      {
        workspaceId: 'engineering-1',
        workspaceRevision: 2,
      },
      7,
    )
    expect(await service.entriesForWindow(7)).toEqual([
      expect.objectContaining({ stage: 'workspace-created' }),
    ])

    setRegistration(evidence(targetDirectory))
    await service.registerWorkspace(record.creationId, 7)
    expect(await service.entriesForWindow(7)).toEqual([
      expect.objectContaining({ stage: 'manifest-registered' }),
    ])
    await service.markWorkspaceCreated(record.creationId, {}, 7)
    expect(await service.entriesForWindow(7)).toEqual([
      expect.objectContaining({ stage: 'manifest-registered' }),
    ])
    settings.set('recent_projects', [recentWorkspace(targetDirectory)])
    await service.complete(record.creationId, 7)
    expect(await readdir(root)).toEqual([])
  })

  it('loads interrupted and corrupt records as attention without deleting targets', async () => {
    const { root, service } = await journal()
    const targetDirectory = join(root, 'project', 'ws_1')
    await mkdir(targetDirectory, { recursive: true })
    const record = await service.begin(8, {
      commandId: 'command-2',
      projectRoot: join(root, 'project'),
      targetDirectory,
      workspaceBindings: {},
      workspaceSpec: {},
    })
    await writeFile(join(root, 'corrupt.json'), '{', 'utf8')

    const restarted = new WorkspaceCreationJournal({
      canonicalizePaths: async (projectRoot, targetDirectory) => ({
        projectRoot,
        targetDirectory,
      }),
      directory: root,
      inspectWorkspaceIdentity: async () => ({}),
      isWorkspace: async () => false,
      projectManifestService: {
        ensureWorkspaceRegistration: vi.fn(),
        inspectWorkspaceRegistration: vi.fn(async () => null),
        removeWorkspaceRegistration: vi.fn(),
      },
      settingsStore: {
        get: vi.fn(async () => null) as never,
        set: vi.fn() as never,
      },
    })
    await restarted.initialize()
    const entries = await restarted.entriesForWindow(999)

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          creationId: record.creationId,
          status: 'unfinished',
          targetDirectory,
        }),
        expect.objectContaining({ status: 'invalid' }),
      ]),
    )
    expect(await readdir(targetDirectory)).toEqual([])
    await expect(restarted.abandon('corrupt', 999)).rejects.toThrow('manual quarantine')
    expect(await readdir(root)).toContain('corrupt.json')
  })

  it('rejects active creation actions from a different window', async () => {
    const { root, service } = await journal()
    const record = await service.begin(7, {
      commandId: 'command-owner',
      projectRoot: join(root, 'project'),
      targetDirectory: join(root, 'project', 'ws_1'),
      workspaceBindings: {},
      workspaceSpec: {},
    })

    await expect(service.markWorkspaceCreated(record.creationId, {}, 8)).rejects.toThrow(
      'not owned by this window',
    )
    await expect(service.abandon(record.creationId, 7)).rejects.toThrow(
      'not awaiting recovery',
    )
  })

  it('serializes Force-quit unfinished state ahead of later stage writes', async () => {
    const { root, service } = await journal()
    const record = await service.begin(7, {
      commandId: 'command-force-race',
      projectRoot: join(root, 'project'),
      targetDirectory: join(root, 'project', 'ws_1'),
      workspaceBindings: {},
      workspaceSpec: {},
    })

    const persistUnfinished = service.markActiveUnfinished(new Set([7]))
    const lateStage = service.markWorkspaceCreated(record.creationId, {}, 7)
    await persistUnfinished

    await expect(lateStage).rejects.toThrow('not owned by this window')
    await expect(service.entriesForWindow(7)).resolves.toEqual([
      expect.objectContaining({ status: 'unfinished' }),
    ])
  })

  it('reports malformed persisted fields as invalid without inspecting the target', async () => {
    const first = await journal()
    const targetDirectory = join(first.root, 'project', 'ws_1')
    const record = await first.service.begin(1, {
      commandId: 'command-malformed',
      projectRoot: join(first.root, 'project'),
      targetDirectory,
      workspaceBindings: {},
      workspaceSpec: {},
    })
    const journalPath = join(first.root, `${record.creationId}.json`)
    const stored = JSON.parse(await readFile(journalPath, 'utf8'))
    delete stored.createdAt
    await writeFile(journalPath, JSON.stringify(stored), 'utf8')
    const isWorkspace = vi.fn(async () => true)
    const restarted = new WorkspaceCreationJournal({
      canonicalizePaths: async (projectRoot, target) => ({
        projectRoot,
        targetDirectory: target,
      }),
      directory: first.root,
      inspectWorkspaceIdentity: async () => ({}),
      isWorkspace,
      projectManifestService: first.projectManifestService,
      settingsStore: first.settingsStore,
    })

    await restarted.initialize()

    expect(await restarted.entriesForWindow(1)).toEqual([
      expect.objectContaining({ creationId: record.creationId, status: 'invalid' }),
    ])
    expect(isWorkspace).not.toHaveBeenCalled()
  })

  it('continues only a complete Workspace and abandons without deleting files', async () => {
    const isWorkspace = vi.fn(async () => true)
    const { projectManifestService, root, service, settings } = await journal(isWorkspace)
    const targetDirectory = join(root, 'project', 'ws_1')
    await mkdir(targetDirectory, { recursive: true })
    await writeFile(join(targetDirectory, 'keep.txt'), 'keep', 'utf8')
    const first = await service.begin(1, {
      commandId: 'command-3',
      projectRoot: join(root, 'project'),
      targetDirectory,
      workspaceBindings: {},
      workspaceSpec: {},
    })
    await service.markUnfinished(first.creationId, 'Application exited.', 1)

    await expect(service.continueInitialization(first.creationId, 1)).resolves.toEqual({
      recovered: true,
    })
    expect(isWorkspace).toHaveBeenCalledWith(targetDirectory)
    expect(projectManifestService.ensureWorkspaceRegistration).toHaveBeenCalledWith(
      join(root, 'project'),
      targetDirectory,
      undefined,
    )
    expect(settings.get('recent_projects')).toEqual([
      expect.objectContaining({ path: targetDirectory }),
    ])

    const second = await service.begin(1, {
      commandId: 'command-4',
      projectRoot: join(root, 'project'),
      targetDirectory,
      workspaceBindings: {},
      workspaceSpec: {},
    })
    await service.markUnfinished(second.creationId, 'Application exited.', 1)
    await expect(service.abandon(second.creationId, 1)).resolves.toEqual({
      abandoned: true,
    })
    expect(await readFile(join(targetDirectory, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('stops recovery when the created Workspace identity changed', async () => {
    const inspectWorkspaceIdentity = vi.fn(async () => ({
      workspaceId: 'engineering-other',
      workspaceRevision: 3,
    }))
    const { root, service } = await journal(
      vi.fn(async () => true),
      inspectWorkspaceIdentity,
    )
    const record = await service.begin(1, {
      commandId: 'command-identity',
      projectRoot: join(root, 'project'),
      targetDirectory: join(root, 'project', 'ws_1'),
      workspaceBindings: {},
      workspaceSpec: {},
    })
    await service.markWorkspaceCreated(
      record.creationId,
      { workspaceId: 'engineering-created', workspaceRevision: 2 },
      1,
    )
    await service.markUnfinished(record.creationId, 'Interrupted.', 1)

    await expect(service.continueInitialization(record.creationId, 1)).resolves.toEqual(
      expect.objectContaining({
        issue: expect.stringContaining('does not match'),
        recovered: false,
      }),
    )
  })

  it('retains the journal when normal completion cannot confirm Project registration', async () => {
    const { root, service, settings } = await journal(async () => true)
    const targetDirectory = join(root, 'project', 'ws_1')
    const record = await service.begin(1, {
      commandId: 'command-5',
      projectRoot: join(root, 'project'),
      targetDirectory,
      workspaceBindings: {},
      workspaceSpec: {},
    })
    await service.markWorkspaceCreated(record.creationId, {}, 1)
    settings.set('recent_projects', [recentWorkspace(targetDirectory)])

    await expect(service.complete(record.creationId, 1)).rejects.toThrow(
      'Project manifest does not contain',
    )
    expect(await readdir(root)).toContain(`${record.creationId}.json`)
  })

  it('abandons only exact registrations introduced after the journal began', async () => {
    const first = await journal(async () => false)
    const targetDirectory = join(first.root, 'project', 'ws_1')
    await mkdir(targetDirectory, { recursive: true })
    await writeFile(join(targetDirectory, 'keep.txt'), 'keep', 'utf8')
    const record = await first.service.begin(1, {
      commandId: 'command-ownership',
      projectRoot: join(first.root, 'project'),
      targetDirectory,
      workspaceBindings: {},
      workspaceSpec: {},
    })
    first.setRegistration(evidence(targetDirectory))
    await first.service.registerWorkspace(record.creationId, 1)
    await first.service.markUnfinished(record.creationId, 'Interrupted.', 1)

    await expect(first.service.abandon(record.creationId, 1)).resolves.toEqual({
      abandoned: true,
    })

    expect(
      first.projectManifestService.removeWorkspaceRegistration,
    ).toHaveBeenCalledOnce()
    expect(first.settings.has('recent_projects')).toBe(false)
    expect(await readFile(join(targetDirectory, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('keeps registrations and journal when a post-crash owner cannot be proved', async () => {
    const first = await journal(async () => false)
    const targetDirectory = join(first.root, 'project', 'ws_1')
    const record = await first.service.begin(1, {
      commandId: 'command-unproved',
      projectRoot: join(first.root, 'project'),
      targetDirectory,
      workspaceBindings: {},
      workspaceSpec: {},
    })
    first.setRegistration(evidence(targetDirectory))
    await first.service.registerWorkspace(record.creationId, 1)
    first.settings.set('recent_projects', [recentWorkspace(targetDirectory)])
    await first.service.markUnfinished(record.creationId, 'Interrupted.', 1)

    await expect(first.service.abandon(record.creationId, 1)).rejects.toThrow(
      'ownership cannot be confirmed',
    )
    expect(
      first.projectManifestService.removeWorkspaceRegistration,
    ).not.toHaveBeenCalled()
    expect(first.settings.get('recent_projects')).toHaveLength(1)
    expect(await readdir(first.root)).toContain(`${record.creationId}.json`)
  })

  it('reconciles an unambiguously completed interrupted creation on startup', async () => {
    const isWorkspace = vi.fn(async () => true)
    const first = await journal(isWorkspace)
    const targetDirectory = join(first.root, 'project', 'ws_1')
    const record = await first.service.begin(1, {
      commandId: 'command-6',
      projectRoot: join(first.root, 'project'),
      targetDirectory,
      workspaceBindings: {},
      workspaceSpec: {},
    })
    await first.service.markWorkspaceCreated(record.creationId, {}, 1)
    first.setRegistration(evidence(targetDirectory))
    first.settings.set('recent_projects', [recentWorkspace(targetDirectory)])

    const restarted = new WorkspaceCreationJournal({
      canonicalizePaths: async (projectRoot, targetDirectory) => ({
        projectRoot,
        targetDirectory,
      }),
      directory: first.root,
      inspectWorkspaceIdentity: async () => ({}),
      isWorkspace,
      projectManifestService: first.projectManifestService,
      settingsStore: first.settingsStore,
    })
    await restarted.initialize()

    expect(await readdir(first.root)).toEqual([])
    expect(await restarted.entriesForWindow(1)).toEqual([
      expect.objectContaining({
        creationId: record.creationId,
        status: 'recovered',
      }),
    ])
  })
})
