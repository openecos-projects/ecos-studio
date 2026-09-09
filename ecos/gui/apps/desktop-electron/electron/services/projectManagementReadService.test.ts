import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
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
  projectManifestForPresentation,
  projectManagementWorkspaceSummaryPaths,
  type EccProjectManifest,
  type EccPersistedEngineeringSnapshot,
} from '@ecos-studio/shared'
import {
  PROJECT_FINDINGS_ARTIFACT_MAX_BYTES,
  ProjectManagementReadService,
} from './projectManagementReadService'

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

  const now = '2026-08-09T00:00:00.000Z'
  const manifest = {
    schema_version: 1,
    project_id: 'proj_gcd',
    name: 'gcd',
    design_name: 'gcd',
    root_path: projectRoot,
    created_at: now,
    updated_at: now,
    objectives: {},
    workspaces: [
      {
        workspace_id: 'ws_0001',
        name: 'ws_0001',
        workspace_path: 'ws_0001',
        source_workspace_id: null,
        lifecycle: 'active',
        created_at: now,
        updated_at: now,
      },
    ],
    mpc: null,
    best_workspace: null,
    qor_baseline: null,
  }
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify(manifest))
  await writeFile(join(workspaceRoot, 'home', 'flow.json'), '{"steps":[]}')
  return { projectRoot, workspaceRoot }
}

function createReadService(
  readStepConfiguration?: (
    workspacePath: string,
    step: string,
  ) => Promise<import('@ecos-studio/shared').EccWorkspaceStepConfigurationReadResult>,
  readWorkspaceConfiguration?: (
    workspacePath: string,
  ) => Promise<import('./projectManagementReadService').ProjectWorkspaceConfiguration>,
): ProjectManagementReadService {
  return new ProjectManagementReadService(
    {
      discover: async () => null,
      load: async (projectRoot) =>
        projectManifestForPresentation(
          JSON.parse(
            await readFile(join(projectRoot, 'project.json'), 'utf8'),
          ) as EccProjectManifest,
          projectRoot,
        ),
    },
    readStepConfiguration,
    readWorkspaceConfiguration,
  )
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
    const service = createReadService()

    await expect(service.readManifest(projectRoot)).resolves.toMatchObject({
      project_id: 'proj_gcd',
      workspaces: [{ workspace_id: 'ws_0001' }],
    })
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

  it('derives the project root from the selected manifest directory', async () => {
    const { projectRoot } = await createProject()
    const manifest = JSON.parse(
      await readFile(join(projectRoot, 'project.json'), 'utf8'),
    ) as {
      root_path: string
    }
    manifest.root_path = '/old/location/gcd'
    await writeFile(join(projectRoot, 'project.json'), JSON.stringify(manifest))

    await expect(createReadService().readManifest(projectRoot)).resolves.toMatchObject({
      root_path: projectRoot,
    })
  })

  it('reuses canonical design defaults from an existing Project Workspace', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const readWorkspaceConfiguration = vi.fn().mockResolvedValue({
      workspaceSpec: {
        design: { name: 'gcd', topModule: 'gcd_top', clockPort: 'clk_i' },
        inputs: [
          { inputId: 'rtl-main', role: 'rtl' },
          { inputId: 'rtl-helper', role: 'rtl' },
          { inputId: 'constraints', role: 'sdc' },
        ],
      },
      workspaceBindings: {
        inputs: {
          'rtl-main': `${workspaceRoot}/origin/gcd.v`,
          'rtl-helper': `${workspaceRoot}/origin/helper.sv`,
          constraints: `${workspaceRoot}/origin/gcd.sdc`,
        },
      },
    })

    const manifest = await createReadService(
      undefined,
      readWorkspaceConfiguration,
    ).readManifest(projectRoot)

    expect(readWorkspaceConfiguration).toHaveBeenCalledWith(workspaceRoot)
    expect(manifest?.base_design).toMatchObject({
      clock: 'clk_i',
      rtl_list: [`${workspaceRoot}/origin/gcd.v`, `${workspaceRoot}/origin/helper.sv`],
      sdc: `${workspaceRoot}/origin/gcd.sdc`,
      top_module: 'gcd_top',
    })
  })

  it('rejects undeclared workspaces and files outside the summary allowlist', async () => {
    const { projectRoot } = await createProject()
    const undeclaredWorkspace = join(projectRoot, 'ws_0002')
    await mkdir(undeclaredWorkspace)
    const service = createReadService()

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

  it('throws ENOTDIR when the project root exists but is not a directory', async () => {
    const { projectRoot } = await createProject()
    const filePath = join(projectRoot, 'not-a-project')
    await writeFile(filePath, 'not a directory')
    const service = createReadService()

    await expect(service.readManifest(filePath)).rejects.toMatchObject({
      code: 'ENOTDIR',
    })
  })

  it('throws ENOENT when the project root directory is gone', async () => {
    const missingRoot = join(tmpdir(), `ecos-project-management-missing-${Date.now()}`)
    const service = createReadService()

    await expect(service.readManifest(missingRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('requires a valid manifest before listing project root entries', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'ecos-project-management-empty-'))
    temporaryDirectories.push(emptyRoot)
    const service = createReadService()

    await expect(service.listProjectEntries(emptyRoot)).rejects.toThrow(
      'Project manifest does not exist.',
    )
  })

  it('keeps readable workspace summaries when one optional artifact exceeds the limit', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const metricsPath = join(workspaceRoot, 'sta_ecc', 'analysis', 'qor_metrics.json')
    await mkdir(join(workspaceRoot, 'sta_ecc', 'analysis'), { recursive: true })
    await writeFile(metricsPath, 'x'.repeat(256 * 1024 + 1))
    const service = createReadService()

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
    const service = createReadService()

    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: workspaceRoot,
        paths: ['home/flow.json'],
      }),
    ).rejects.toThrow('outside its workspace')
  })

  it('reads Step Options through the ECC domain reader and rejects config file paths', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const readStepConfiguration = vi.fn().mockResolvedValue({
      options: { cts_buf_list: 'BUF' },
      status: 'available',
      step: 'CTS',
      stepId: 'CTS',
      workspaceId: 'workspace-1',
      workspaceRevision: 1,
    })
    const service = createReadService(readStepConfiguration)

    await expect(
      service.readWorkspaceStepConfiguration({
        projectRoot,
        step: 'CTS',
        workspacePath: workspaceRoot,
      }),
    ).resolves.toEqual({
      options: { cts_buf_list: 'BUF' },
      step: 'CTS',
      stepId: 'CTS',
      status: 'available',
      workspaceId: 'workspace-1',
      workspaceRevision: 1,
    })
    expect(readStepConfiguration).toHaveBeenCalledWith(workspaceRoot, 'CTS')
    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: workspaceRoot,
        paths: ['config/cts_ecc.json'],
      }),
    ).rejects.toThrow('not allowed')
  })

  it('reads and validates one persisted Engineering Snapshot without a Runtime session', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const text = JSON.stringify(engineeringSnapshot())
    await writeFile(join(workspaceRoot, 'home', 'engineering-snapshot.json'), text)

    const result = await createReadService().readEngineeringSnapshot({
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

  it('loads the matching stale predecessor without replacing the current Revision', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const stale = engineeringSnapshot()
    const current = {
      ...engineeringSnapshot(),
      workspaceRevision: 2,
      stalePredecessor: {
        workspaceRevision: 1,
        invalidatedStepIds: ['Place', 'CTS'],
      },
    }
    await writeFile(
      join(workspaceRoot, 'home', 'engineering-snapshot.json'),
      JSON.stringify(current),
    )
    await writeFile(
      join(workspaceRoot, 'home', 'engineering-snapshot.stale.json'),
      JSON.stringify(stale),
    )

    const result = await createReadService().readEngineeringSnapshot({
      projectRoot,
      workspacePath: workspaceRoot,
    })

    expect(result).toMatchObject({
      ok: true,
      snapshot: { workspaceRevision: 2 },
      staleSnapshot: {
        ok: true,
        snapshot: { workspaceRevision: 1 },
      },
    })
  })

  it('returns a stable reason when the Engineering Snapshot is missing', async () => {
    const { projectRoot, workspaceRoot } = await createProject()

    await expect(
      createReadService().readEngineeringSnapshot({
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
      JSON.stringify({ ...engineeringSnapshot(), schemaVersion: 3 }),
    )

    await expect(
      createReadService().readEngineeringSnapshot({
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
      createReadService().readEngineeringSnapshot({
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
      createReadService().readEngineeringSnapshot({
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

  it('defers Artifact realpath validation until the declared Artifact is requested', async () => {
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

    const service = createReadService()
    const result = await service.readEngineeringSnapshot({
      projectRoot,
      workspacePath: workspaceRoot,
    })

    expect(result.ok && result.sections.artifacts).toEqual({
      status: 'ready',
      data: snapshot.artifacts,
      issues: [],
    })
    await expect(
      service.readVerifiedArtifact({
        artifact: { reference, sha256: 'a'.repeat(64), sizeBytes: 2 },
        projectRoot,
        workspacePath: workspaceRoot,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE',
    })
  })

  it('reads only bounded artifacts whose size, hash, and JSON match the Snapshot', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const reference = 'route_ecc/analysis/qor_metrics.json'
    const path = join(workspaceRoot, reference)
    const valid = '{"schema_version":3,"metrics":[]}'
    await mkdir(join(workspaceRoot, 'route_ecc', 'analysis'), { recursive: true })
    await writeFile(path, valid)
    const request = (sizeBytes: number, sha256: string) => ({
      artifacts: [{ reference, sha256, sizeBytes }],
      projectRoot,
      workspacePath: workspaceRoot,
    })
    const service = createReadService()

    await expect(
      service.readVerifiedArtifacts(
        request(
          Buffer.byteLength(valid),
          createHash('sha256').update(valid).digest('hex'),
        ),
      ),
    ).resolves.toEqual({ ok: true, texts: { [reference]: valid } })
    await expect(
      service.readVerifiedArtifact({
        ...request(
          Buffer.byteLength(valid),
          createHash('sha256').update(valid).digest('hex'),
        ),
        artifact: request(
          Buffer.byteLength(valid),
          createHash('sha256').update(valid).digest('hex'),
        ).artifacts[0]!,
      }),
    ).resolves.toEqual({ ok: true, bytes: new TextEncoder().encode(valid) })

    await expect(
      service.readVerifiedArtifacts(
        request(Buffer.byteLength(valid) + 1, 'a'.repeat(64)),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'ARTIFACT_REVISION_MISMATCH' })
    await expect(
      service.readVerifiedArtifacts(request(Buffer.byteLength(valid), 'a'.repeat(64))),
    ).resolves.toMatchObject({ ok: false, code: 'ARTIFACT_REVISION_MISMATCH' })

    const invalidJson = 'x'.repeat(Buffer.byteLength(valid))
    await writeFile(path, invalidJson)
    await expect(
      service.readVerifiedArtifacts(
        request(
          Buffer.byteLength(invalidJson),
          createHash('sha256').update(invalidJson).digest('hex'),
        ),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'FINDINGS_ARTIFACT_INVALID_JSON' })

    await writeFile(path, 'x'.repeat(PROJECT_FINDINGS_ARTIFACT_MAX_BYTES + 1))
    await expect(
      service.readVerifiedArtifacts(
        request(PROJECT_FINDINGS_ARTIFACT_MAX_BYTES + 1, 'a'.repeat(64)),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'FINDINGS_ARTIFACT_TOO_LARGE' })

    await unlink(path)
    await expect(
      service.readVerifiedArtifacts(request(Buffer.byteLength(valid), 'a'.repeat(64))),
    ).resolves.toMatchObject({ ok: false, code: 'ARTIFACT_REFERENCE_MISSING' })

    const outside = join(projectRoot, 'outside-findings.json')
    await writeFile(outside, valid)
    await symlink(outside, path)
    await expect(
      service.readVerifiedArtifacts(request(Buffer.byteLength(valid), 'a'.repeat(64))),
    ).resolves.toMatchObject({ ok: false, code: 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE' })
  })
})
