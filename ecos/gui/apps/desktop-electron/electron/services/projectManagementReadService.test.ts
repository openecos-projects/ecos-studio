import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ENGINEERING_SNAPSHOT_MAX_BYTES,
  createProjectManifestDraft,
  projectManagementWorkspaceSummaryPaths,
  registerWorkspaceInManifest,
  type EccPersistedEngineeringSnapshot,
} from '@ecos-studio/shared'
import { ProjectManagementReadService } from './projectManagementReadService'

const temporaryDirectories: string[] = []

function engineeringSnapshot(): EccPersistedEngineeringSnapshot {
  return {
    analysis: { steps: [] },
    artifacts: [],
    checklist: {},
    flow: { steps: [] },
    metrics: [],
    parameters: {},
    qorAssessment: {
      status: 'unavailable',
      metrics: [],
      score: { value: null, threshold: 60, gate: 'unavailable' },
      steps: [],
    },
    schemaVersion: 1,
    signoffAssessment: { status: 'ready', groups: [], risks: [] },
    workspaceId: 'engineering-workspace',
    workspaceRevision: 1,
  }
}

async function createProject(): Promise<{ projectRoot: string; workspaceRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'ecos-project-management-read-'))
  temporaryDirectories.push(projectRoot)
  const workspaceRoot = join(projectRoot, 'ws_0001')
  await mkdir(join(workspaceRoot, 'home'), { recursive: true })

  const manifest = registerWorkspaceInManifest(
    createProjectManifestDraft({
      rootPath: projectRoot,
      name: 'gcd',
      designName: 'gcd',
    }),
    {
      projectRoot,
      workspacePath: workspaceRoot,
      now: '2026-08-09T00:00:00.000Z',
    },
  )
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify(manifest))
  await writeFile(join(workspaceRoot, 'home', 'flow.json'), '{"steps":[]}')
  return { projectRoot, workspaceRoot }
}

describe('ProjectManagementReadService', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it('reads a historical project and its declared workspace without an active workspace scope', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const service = new ProjectManagementReadService()

    await expect(service.readManifest(projectRoot)).resolves.toContain(
      '"workspace_id":"ws_0001"',
    )
    await expect(service.listProjectEntries(projectRoot)).resolves.toEqual([
      'project.json',
      'ws_0001',
    ])
    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: workspaceRoot,
        paths: ['home/flow.json', 'sta_ecc/analysis/qor_metrics.json'],
      }),
    ).resolves.toEqual({
      texts: {
        'home/flow.json': '{"steps":[]}',
        'sta_ecc/analysis/qor_metrics.json': null,
      },
      unavailablePaths: [],
    })
    const summaries = await service.readWorkspaceTexts({
      projectRoot,
      workspacePath: workspaceRoot,
      paths: [...projectManagementWorkspaceSummaryPaths],
    })
    expect(summaries).toMatchObject({
      texts: expect.objectContaining({
        'lvs_ecc/analysis/qor_metrics.json': null,
      }),
      unavailablePaths: [],
    })
    expect(summaries.texts).not.toHaveProperty('home/flow.json')
  })

  it('returns project.json text even when root_path does not match the selected directory', async () => {
    const { projectRoot } = await createProject()
    const manifest = JSON.parse(
      await readFile(join(projectRoot, 'project.json'), 'utf8'),
    ) as {
      root_path: string
    }
    manifest.root_path = '/old/location/gcd'
    await writeFile(join(projectRoot, 'project.json'), JSON.stringify(manifest))

    await expect(
      new ProjectManagementReadService().readManifest(projectRoot),
    ).resolves.toContain('"root_path":"/old/location/gcd"')
  })

  it('rejects undeclared workspaces and files outside the summary allowlist', async () => {
    const { projectRoot } = await createProject()
    const undeclaredWorkspace = join(projectRoot, 'ws_0002')
    await mkdir(undeclaredWorkspace)
    const service = new ProjectManagementReadService()

    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: undeclaredWorkspace,
        paths: ['home/flow.json'],
      }),
    ).rejects.toThrow('not declared')
    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: join(projectRoot, 'ws_0001'),
        paths: ['../../settings.json'],
      }),
    ).rejects.toThrow('not allowed')
  })

  it('requires a valid manifest before listing project root entries', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'ecos-project-management-empty-'))
    temporaryDirectories.push(emptyRoot)
    const service = new ProjectManagementReadService()

    await expect(service.listProjectEntries(emptyRoot)).rejects.toThrow(
      'Project manifest does not exist.',
    )
  })

  it('keeps readable workspace summaries when one optional artifact exceeds the limit', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const metricsPath = join(workspaceRoot, 'sta_ecc', 'analysis', 'qor_metrics.json')
    await mkdir(join(workspaceRoot, 'sta_ecc', 'analysis'), { recursive: true })
    await writeFile(metricsPath, 'x'.repeat(256 * 1024 + 1))
    const service = new ProjectManagementReadService()

    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: workspaceRoot,
        paths: ['home/flow.json', 'sta_ecc/analysis/qor_metrics.json'],
      }),
    ).resolves.toEqual({
      texts: {
        'home/flow.json': '{"steps":[]}',
        'sta_ecc/analysis/qor_metrics.json': null,
      },
      unavailablePaths: ['sta_ecc/analysis/qor_metrics.json'],
    })
  })

  it('rejects an allowed artifact path that resolves outside its workspace', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const flowPath = join(workspaceRoot, 'home', 'flow.json')
    await unlink(flowPath)
    await symlink(join(projectRoot, 'project.json'), flowPath)
    const service = new ProjectManagementReadService()

    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: workspaceRoot,
        paths: ['home/flow.json'],
      }),
    ).rejects.toThrow('outside its workspace')
  })

  it('serves step-config files from a declared workspace but rejects unlisted config paths', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const configDir = join(workspaceRoot, 'config')
    await mkdir(configDir)
    await writeFile(join(configDir, 'cts_ecc.json'), '{"cts_buf_list":"BUF"}')
    const service = new ProjectManagementReadService()

    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: workspaceRoot,
        paths: ['home/flow.json', 'config/cts_ecc.json', 'config/rcx.json'],
      }),
    ).resolves.toEqual({
      texts: {
        'home/flow.json': '{"steps":[]}',
        'config/cts_ecc.json': '{"cts_buf_list":"BUF"}',
        'config/rcx.json': null,
      },
      unavailablePaths: [],
    })
    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: workspaceRoot,
        paths: ['config/evil.json'],
      }),
    ).rejects.toThrow('not allowed')
  })

  it('reads and validates one persisted Engineering Snapshot without a Runtime session', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const text = JSON.stringify(engineeringSnapshot())
    await writeFile(join(workspaceRoot, 'home', 'engineering-snapshot.json'), text)

    const result = await new ProjectManagementReadService().readEngineeringSnapshot({
      projectRoot,
      workspacePath: workspaceRoot,
    })

    expect(result).toMatchObject({
      ok: true,
      readBytes: Buffer.byteLength(text),
      sections: {
        artifacts: { status: 'ready' },
        flow: { status: 'ready' },
        qor: { status: 'ready' },
        signoff: { status: 'ready' },
      },
      snapshot: {
        workspaceId: 'engineering-workspace',
        workspaceRevision: 1,
      },
    })
  })

  it('returns a stable reason when the Engineering Snapshot is missing', async () => {
    const { projectRoot, workspaceRoot } = await createProject()

    await expect(
      new ProjectManagementReadService().readEngineeringSnapshot({
        projectRoot,
        workspacePath: workspaceRoot,
      }),
    ).resolves.toEqual({
      ok: false,
      readBytes: 0,
      issue: { code: 'ENGINEERING_SNAPSHOT_MISSING' },
    })
  })

  it('returns a stable reason for an unsupported Engineering Snapshot schema', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    await writeFile(
      join(workspaceRoot, 'home', 'engineering-snapshot.json'),
      JSON.stringify({ ...engineeringSnapshot(), schemaVersion: 2 }),
    )

    await expect(
      new ProjectManagementReadService().readEngineeringSnapshot({
        projectRoot,
        workspacePath: workspaceRoot,
      }),
    ).resolves.toMatchObject({
      ok: false,
      issue: { code: 'ENGINEERING_SNAPSHOT_SCHEMA_UNSUPPORTED' },
    })
  })

  it('rejects a declared Workspace symlink that resolves outside the Project', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const outside = await mkdtemp(join(tmpdir(), 'ecos-project-workspace-outside-'))
    temporaryDirectories.push(outside)
    await mkdir(join(outside, 'home'))
    await writeFile(
      join(outside, 'home', 'engineering-snapshot.json'),
      JSON.stringify(engineeringSnapshot()),
    )
    await rm(workspaceRoot, { recursive: true })
    await symlink(outside, workspaceRoot, 'dir')

    await expect(
      new ProjectManagementReadService().readEngineeringSnapshot({
        projectRoot,
        workspacePath: workspaceRoot,
      }),
    ).resolves.toEqual({
      ok: false,
      readBytes: 0,
      issue: { code: 'WORKSPACE_PATH_OUTSIDE_PROJECT' },
    })
  })

  it('rejects an oversized Engineering Snapshot before parsing with exact sizes', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    await writeFile(
      join(workspaceRoot, 'home', 'engineering-snapshot.json'),
      Buffer.alloc(ENGINEERING_SNAPSHOT_MAX_BYTES + 1),
    )

    await expect(
      new ProjectManagementReadService().readEngineeringSnapshot({
        projectRoot,
        workspacePath: workspaceRoot,
      }),
    ).resolves.toEqual({
      ok: false,
      readBytes: ENGINEERING_SNAPSHOT_MAX_BYTES + 1,
      issue: {
        code: 'ENGINEERING_SNAPSHOT_TOO_LARGE',
        actualSizeBytes: ENGINEERING_SNAPSHOT_MAX_BYTES + 1,
        allowedSizeBytes: ENGINEERING_SNAPSHOT_MAX_BYTES,
      },
    })
  })

  it('marks an available Artifact reference invalid when its symlink escapes the Workspace', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const outside = join(projectRoot, 'outside.json')
    const reference = 'sta_ecc/analysis/qor_metrics.json'
    await writeFile(outside, '{}')
    await mkdir(join(workspaceRoot, 'sta_ecc', 'analysis'), { recursive: true })
    await symlink(outside, join(workspaceRoot, reference))
    const snapshot = engineeringSnapshot()
    snapshot.artifacts.push({
      artifactId: 'artifact-metrics',
      availability: 'available',
      kind: 'qor_metrics',
      name: 'qor_metrics.json',
      reference,
      sha256: 'a'.repeat(64),
      sizeBytes: 2,
      stepId: 'sta',
    })
    await writeFile(
      join(workspaceRoot, 'home', 'engineering-snapshot.json'),
      JSON.stringify(snapshot),
    )

    const result = await new ProjectManagementReadService().readEngineeringSnapshot({
      projectRoot,
      workspacePath: workspaceRoot,
    })

    expect(result.ok && result.sections.artifacts).toEqual({
      status: 'unavailable',
      issues: [{ code: 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE' }],
    })
  })
})
