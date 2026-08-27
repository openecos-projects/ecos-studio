import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseProjectManifest } from '@ecos-studio/shared'
import {
  ProjectManifestService,
  type ProjectManifestBaselineSnapshotProvider,
  type ProjectManifestReplacementProvider,
} from './projectManifestService'

const temporaryDirectories: string[] = []

async function createTemporaryProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ecos-project-manifest-service-'))
  temporaryDirectories.push(directory)
  return directory
}

function createService(
  projectRoot: string,
  replacementProvider?: ProjectManifestReplacementProvider,
  baselineSnapshotProvider?: ProjectManifestBaselineSnapshotProvider,
): ProjectManifestService {
  return new ProjectManifestService(
    {
      resolveProjectRoot: async (path) => {
        if (path !== projectRoot) throw new Error('Unexpected project root')
        return projectRoot
      },
    },
    replacementProvider,
    baselineSnapshotProvider,
  )
}

describe('ProjectManifestService', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it('serializes concurrent workspace registrations for the same project', async () => {
    const projectRoot = await createTemporaryProject()
    const service = createService(projectRoot)

    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'gcd', designName: 'gcd' },
    })

    await Promise.all([
      service.mutate({
        projectRoot,
        mutation: {
          type: 'register-workspace',
          input: {
            projectRoot,
            projectName: 'gcd',
            workspacePath: join(projectRoot, 'ws_0001'),
          },
        },
      }),
      service.mutate({
        projectRoot,
        mutation: {
          type: 'register-workspace',
          input: {
            projectRoot,
            projectName: 'gcd',
            workspacePath: join(projectRoot, 'ws_0002'),
          },
        },
      }),
    ])

    const manifest = parseProjectManifest(
      await readFile(join(projectRoot, 'project.json'), 'utf8'),
    )
    expect(manifest.workspaces.map((workspace) => workspace.workspace_id).sort()).toEqual(
      ['ws_0001', 'ws_0002'],
    )
  })

  it('writes project manifests atomically and refuses to overwrite an existing project manifest', async () => {
    const projectRoot = await createTemporaryProject()
    const service = createService(projectRoot)

    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'gcd', designName: 'gcd' },
    })

    await expect(
      service.mutate({
        projectRoot,
        mutation: { type: 'create', name: 'replacement', designName: 'replacement' },
      }),
    ).rejects.toThrow('Project manifest already exists')

    const manifest = parseProjectManifest(
      await readFile(join(projectRoot, 'project.json'), 'utf8'),
    )
    expect(manifest.name).toBe('gcd')
    expect(
      (await readdir(projectRoot)).filter((entry) => entry.endsWith('.tmp')),
    ).toEqual([])
  })

  it('writes the selected MPC association when creating a project manifest', async () => {
    const projectRoot = await createTemporaryProject()
    const service = createService(projectRoot)
    const mpcPath = '/resources/mpcs/mpc-frame/0.1.0'

    const result = await service.mutate({
      projectRoot,
      mutation: {
        type: 'create',
        name: 'gcd',
        designName: 'gcd',
        mpc: {
          resource_id: 'mpc:mpc-frame',
          display_name: 'MPC Frame',
          installed_version: '0.1.0',
          path: mpcPath,
          spec_path: `${mpcPath}/spec/spec.json.in`,
          design: { index: 0, design_name: 'frame' },
          core_template: { minimum_area: 100, maximum_area: 500 },
        },
      },
    })

    expect(parseProjectManifest(result.content).mpc).toEqual({
      resource_id: 'mpc:mpc-frame',
      display_name: 'MPC Frame',
      installed_version: '0.1.0',
      path: mpcPath,
      spec_path: `${mpcPath}/spec/spec.json.in`,
      design: { index: 0, design_name: 'frame' },
      core_template: { minimum_area: 100, maximum_area: 500 },
    })
  })

  it('atomically synchronizes the selected baseline without replacing project design_name', async () => {
    const projectRoot = await createTemporaryProject()
    const workspaceOne = join(projectRoot, 'ws_0001')
    const workspaceTwo = join(projectRoot, 'ws_0002')
    const snapshots: string[] = []
    const service = createService(projectRoot, undefined, {
      loadBaselineSnapshot: async (workspacePath) => {
        snapshots.push(workspacePath)
        return {
          parameters: {
            PDK: 'ics55-baseline',
            'PDK Root': '/pdks/ics55-baseline',
            Design: 'workspace_specific_design',
            'Top module': 'baseline_top',
            Clock: 'baseline_clk',
            'Frequency max [MHz]': 123,
            'Max fanout': 17,
          },
          pdk: {},
          db: {
            INPUT: {
              rtl_list: ['/sources/baseline.sv'],
              origin_def: '/sources/baseline.def',
              origin_verilog: '/sources/baseline.v',
            },
          },
        }
      },
    })

    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'project label', designName: 'project_design' },
    })
    for (const workspacePath of [workspaceOne, workspaceTwo]) {
      await service.mutate({
        projectRoot,
        mutation: {
          type: 'register-workspace',
          input: { projectRoot, workspacePath },
        },
      })
    }

    const result = await service.mutate({
      projectRoot,
      mutation: {
        type: 'select-qor-baseline',
        workspaceId: 'ws_0002',
        reason: 'Selected from Dashboard QoR Overview',
      },
    })

    const manifest = parseProjectManifest(result.content)
    expect(snapshots).toEqual([workspaceTwo])
    expect(manifest.design_name).toBe('project_design')
    expect(manifest.qor_baseline).toEqual({
      workspace_id: 'ws_0002',
      reason: 'Selected from Dashboard QoR Overview',
    })
    expect(manifest.base_design).toMatchObject({
      pdk: 'ics55-baseline',
      pdk_root: '/pdks/ics55-baseline',
      top_module: 'baseline_top',
      clock: 'baseline_clk',
      rtl_list: ['/sources/baseline.sv'],
      origin_def: '/sources/baseline.def',
      origin_verilog: '/sources/baseline.v',
      parameters: {
        design: 'project_design',
        frequency_max: 123,
        max_fanout: 17,
      },
    })
    await expect(readFile(join(projectRoot, 'project.json'), 'utf8')).resolves.toBe(
      result.content,
    )
  })

  it('retains canonical ecc.toml geometry when synchronizing the baseline', async () => {
    const projectRoot = await createTemporaryProject()
    const workspacePath = join(projectRoot, 'ws_0001')
    const service = createService(projectRoot, undefined, {
      loadBaselineSnapshot: async () => ({
        parameters: {
          pdk: 'ics55',
          pdk_root: '/pdks/ics55',
          design: 'gcd',
          top_module: 'gcd',
          clock: 'clk',
          frequency_max: 150,
          max_fanout: 24,
          die: { size: [46.2, 47.4], area: 2189.88 },
          core: { utilitization: 0.4, margin: [3, 3] },
        },
        pdk: {},
        db: { INPUT: {} },
      }),
    })

    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'project label', designName: 'project_design' },
    })
    await service.mutate({
      projectRoot,
      mutation: {
        type: 'register-workspace',
        input: { projectRoot, workspacePath },
      },
    })

    const result = await service.mutate({
      projectRoot,
      mutation: { type: 'select-qor-baseline', workspaceId: 'ws_0001' },
    })

    expect(parseProjectManifest(result.content).base_design.parameters).toMatchObject({
      design: 'project_design',
      top_module: 'gcd',
      clock: 'clk',
      frequency_max: 150,
      max_fanout: 24,
      die_width: 46.2,
      die_height: 47.4,
      utilitization: 0.4,
      margin: 3,
    })
  })

  it('rejects a baseline snapshot holding a bigint die dimension instead of shifting positions', async () => {
    const projectRoot = await createTemporaryProject()
    const workspacePath = join(projectRoot, 'ws_0001')
    const service = createService(projectRoot, undefined, {
      loadBaselineSnapshot: async () => ({
        parameters: {
          pdk: 'ics55',
          pdk_root: '/pdks/ics55',
          design: 'gcd',
          top_module: 'gcd',
          clock: 'clk',
          die: { size: [9007199254740993n, 47.4], area: 2189.88 },
          core: { utilitization: 0.4, margin: [3, 3] },
        },
        pdk: {},
        db: { INPUT: {} },
      }),
    })

    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'project label', designName: 'project_design' },
    })
    await service.mutate({
      projectRoot,
      mutation: { type: 'register-workspace', input: { projectRoot, workspacePath } },
    })

    await expect(
      service.mutate({
        projectRoot,
        mutation: { type: 'select-qor-baseline', workspaceId: 'ws_0001' },
      }),
    ).rejects.toThrow(/not a finite number/i)
  })

  it('rejects a baseline snapshot holding a non-finite frequency instead of serializing null', async () => {
    const projectRoot = await createTemporaryProject()
    const workspacePath = join(projectRoot, 'ws_0001')
    const service = createService(projectRoot, undefined, {
      loadBaselineSnapshot: async () => ({
        parameters: {
          pdk: 'ics55',
          pdk_root: '/pdks/ics55',
          design: 'gcd',
          top_module: 'gcd',
          clock: 'clk',
          frequency_max: Infinity,
          core: { utilitization: 0.4, margin: [3, 3] },
        },
        pdk: {},
        db: { INPUT: {} },
      }),
    })

    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'project label', designName: 'project_design' },
    })
    await service.mutate({
      projectRoot,
      mutation: { type: 'register-workspace', input: { projectRoot, workspacePath } },
    })

    await expect(
      service.mutate({
        projectRoot,
        mutation: { type: 'select-qor-baseline', workspaceId: 'ws_0001' },
      }),
    ).rejects.toThrow(/cannot represent losslessly/i)
  })

  it('does not write a partial baseline mutation when its snapshot is incomplete', async () => {
    const projectRoot = await createTemporaryProject()
    const workspacePath = join(projectRoot, 'ws_0001')
    const service = createService(projectRoot, undefined, {
      loadBaselineSnapshot: async () => ({
        parameters: { PDK: 'ics55' },
        pdk: {},
        db: {},
      }),
    })
    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'gcd', designName: 'gcd' },
    })
    await service.mutate({
      projectRoot,
      mutation: {
        type: 'register-workspace',
        input: { projectRoot, workspacePath },
      },
    })
    const manifestPath = join(projectRoot, 'project.json')
    const before = await readFile(manifestPath, 'utf8')

    await expect(
      service.mutate({
        projectRoot,
        mutation: { type: 'select-qor-baseline', workspaceId: 'ws_0001' },
      }),
    ).rejects.toThrow('Baseline workspace snapshot is incomplete')

    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(before)
  })

  it('does not overwrite a malformed manifest when a mutation cannot be parsed', async () => {
    const projectRoot = await createTemporaryProject()
    const manifestPath = join(projectRoot, 'project.json')
    await writeFile(manifestPath, '{not json', 'utf8')
    const service = createService(projectRoot)

    await expect(
      service.mutate({
        projectRoot,
        mutation: { type: 'delete-workspace', workspaceId: 'ws_0001' },
      }),
    ).rejects.toThrow('Invalid project manifest JSON')
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe('{not json')
  })

  it('does not treat an existing empty manifest as absent', async () => {
    const projectRoot = await createTemporaryProject()
    const manifestPath = join(projectRoot, 'project.json')
    await writeFile(manifestPath, '', 'utf8')
    const service = createService(projectRoot)

    await expect(
      service.mutate({
        projectRoot,
        mutation: { type: 'create', name: 'gcd', designName: 'gcd' },
      }),
    ).rejects.toThrow('Invalid project manifest JSON')
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe('')
  })

  it('rejects malformed mutation payloads before reading or writing a manifest', async () => {
    const projectRoot = await createTemporaryProject()
    const service = createService(projectRoot)

    await expect(
      service.mutate({
        projectRoot,
        mutation: {
          type: 'register-workspace',
        } as never,
      }),
    ).rejects.toThrow('Project manifest workspace registration input must be an object')

    await expect(
      service.mutate({
        projectRoot,
        mutation: {
          type: 'create',
          name: 'gcd',
          designName: 'gcd',
          mpc: {
            resource_id: 'mpc:mpc-frame',
            display_name: 'MPC Frame',
            installed_version: '0.1.0',
            path: '/resources/mpcs/mpc-frame/0.1.0',
            spec_path: '/resources/mpcs/mpc-frame/0.1.0/spec.json.in',
            design: { index: 0, design_name: 'frame' },
            core_template: { minimum_area: 100, maximum_area: 500 },
          },
        },
      }),
    ).rejects.toThrow('MPC spec_path must reference spec/spec.json.in')

    await expect(
      readFile(join(projectRoot, 'project.json'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects a manifest whose root_path points at another project directory', async () => {
    const projectRoot = await createTemporaryProject()
    const otherProjectRoot = await createTemporaryProject()
    const manifestPath = join(projectRoot, 'project.json')
    const content = JSON.stringify({
      schema_version: 1,
      project_id: 'proj_gcd',
      name: 'gcd',
      design_name: 'gcd',
      root_path: otherProjectRoot,
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
      base_design: { rtl_list: [] },
      objectives: { primary: 'timing', directions: {} },
      workspaces: [],
      best_workspace: null,
    })
    await writeFile(manifestPath, content, 'utf8')
    const service = new ProjectManifestService({
      resolveProjectRoot: async (path) => path,
    })

    await expect(
      service.mutate({
        projectRoot,
        mutation: { type: 'delete-workspace', workspaceId: 'ws_0001' },
      }),
    ).rejects.toThrow('root_path does not match')
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(content)
  })

  it('deletes a manifest-owned workspace directory through the main-process transaction', async () => {
    const projectRoot = await createTemporaryProject()
    const workspacePath = join(projectRoot, 'ws_0001')
    const replacement = {
      id: 'replacement-1',
      targetPath: workspacePath,
      backupPath: join(projectRoot, '.ws_0001.replace-backup-1'),
    }
    const calls: string[] = []
    const service = createService(projectRoot, {
      finalizeProjectDirectoryReplacement: async (replacementId) => {
        calls.push(`finalize:${replacementId}`)
      },
      getProjectDirectoryReplacement: (replacementId) => ({
        ...replacement,
        id: replacementId,
        projectRoot,
      }),
      prepareManagedProjectWorkspaceDirectoryReplacement: async (
        root,
        workspaceId,
        path,
      ) => {
        calls.push(`prepare:${root}:${workspaceId}:${path}`)
        return replacement
      },
      retainProjectDirectoryReplacement: async () => undefined,
      restoreProjectDirectoryReplacement: async (replacementId) => {
        calls.push(`restore:${replacementId}`)
      },
      setProjectDirectoryReplacementRecoveryMode: async (replacementId, mode) => {
        calls.push(`mode:${replacementId}:${mode}`)
      },
    })

    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'gcd', designName: 'gcd' },
    })

    await service.mutate({
      projectRoot,
      mutation: {
        type: 'register-workspace',
        input: {
          projectRoot,
          projectName: 'gcd',
          workspacePath,
        },
      },
    })
    await service.mutate({
      projectRoot,
      mutation: {
        type: 'delete-workspace',
        workspaceId: 'ws_0001',
        deleteDirectory: true,
      },
    })

    expect(calls).toEqual([
      `prepare:${projectRoot}:ws_0001:${workspacePath}`,
      'mode:replacement-1:delete',
      'finalize:replacement-1',
    ])
    const manifest = parseProjectManifest(
      await readFile(join(projectRoot, 'project.json'), 'utf8'),
    )
    expect(manifest.workspaces).toEqual([])
  })

  it('records a replacement backup from the trusted token and releases it after writing', async () => {
    const projectRoot = await createTemporaryProject()
    const retainedReplacementIds: string[] = []
    const replacementRecoveryModes: Array<{ id: string; mode: 'delete' | 'retain' }> = []
    const replacementProvider: ProjectManifestReplacementProvider = {
      finalizeProjectDirectoryReplacement: async () => undefined,
      getProjectDirectoryReplacement: (replacementId) => {
        expect(replacementId).toBe('replacement-1')
        return {
          backupPath: join(projectRoot, '.ws_0001.replace-backup-1'),
          projectRoot,
          targetPath: join(projectRoot, 'ws_0001'),
        }
      },
      prepareManagedProjectWorkspaceDirectoryReplacement: async () => null,
      retainProjectDirectoryReplacement: async (replacementId) => {
        retainedReplacementIds.push(replacementId)
      },
      restoreProjectDirectoryReplacement: async () => undefined,
      setProjectDirectoryReplacementRecoveryMode: async (replacementId, mode) => {
        replacementRecoveryModes.push({ id: replacementId, mode })
      },
    }
    const service = createService(projectRoot, replacementProvider)

    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'gcd', designName: 'gcd' },
    })
    const result = await service.mutate({
      projectRoot,
      mutation: {
        type: 'record-replacement-backup',
        input: {
          replacementId: 'replacement-1',
          fallbackStartStep: 'Synth',
          fallbackEndStep: 'Harden',
        },
      },
    })

    const manifest = parseProjectManifest(result.content)
    expect(manifest.workspaces).toMatchObject([
      {
        workspace_id: '.ws_0001.replace-backup-1',
        workspace_path: join(projectRoot, '.ws_0001.replace-backup-1'),
        status: 'archived',
        start_step: 'Synth',
        end_step: 'Harden',
      },
    ])
    expect(retainedReplacementIds).toEqual(['replacement-1'])
    expect(replacementRecoveryModes).toEqual([{ id: 'replacement-1', mode: 'retain' }])
  })

  it('keeps a durable replacement-backup mutation when token cleanup is deferred', async () => {
    const projectRoot = await createTemporaryProject()
    const service = createService(projectRoot, {
      finalizeProjectDirectoryReplacement: async () => undefined,
      getProjectDirectoryReplacement: () => ({
        backupPath: join(projectRoot, '.ws_0001.replace-backup-1'),
        projectRoot,
        targetPath: join(projectRoot, 'ws_0001'),
      }),
      prepareManagedProjectWorkspaceDirectoryReplacement: async () => null,
      retainProjectDirectoryReplacement: async () => {
        throw new Error('journal cleanup failed')
      },
      restoreProjectDirectoryReplacement: async () => undefined,
      setProjectDirectoryReplacementRecoveryMode: async () => undefined,
    })

    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'gcd', designName: 'gcd' },
    })
    const result = await service.mutate({
      projectRoot,
      mutation: {
        type: 'record-replacement-backup',
        input: { replacementId: 'replacement-1' },
      },
    })

    expect(result.cleanupPending).toBe(true)
    expect(parseProjectManifest(result.content).workspaces).toMatchObject([
      {
        workspace_id: '.ws_0001.replace-backup-1',
        workspace_path: join(projectRoot, '.ws_0001.replace-backup-1'),
      },
    ])
  })

  it('rejects a replacement token from another project without changing the manifest', async () => {
    const projectRoot = await createTemporaryProject()
    const foreignProjectRoot = await createTemporaryProject()
    const retainedReplacementIds: string[] = []
    const service = createService(projectRoot, {
      finalizeProjectDirectoryReplacement: async () => undefined,
      getProjectDirectoryReplacement: () => ({
        backupPath: join(foreignProjectRoot, '.ws_0001.replace-backup-1'),
        projectRoot: foreignProjectRoot,
        targetPath: join(foreignProjectRoot, 'ws_0001'),
      }),
      prepareManagedProjectWorkspaceDirectoryReplacement: async () => null,
      retainProjectDirectoryReplacement: async (replacementId) => {
        retainedReplacementIds.push(replacementId)
      },
      restoreProjectDirectoryReplacement: async () => undefined,
      setProjectDirectoryReplacementRecoveryMode: async () => undefined,
    })

    await service.mutate({
      projectRoot,
      mutation: { type: 'create', name: 'gcd', designName: 'gcd' },
    })
    const manifestPath = join(projectRoot, 'project.json')
    const before = await readFile(manifestPath, 'utf8')

    await expect(
      service.mutate({
        projectRoot,
        mutation: {
          type: 'record-replacement-backup',
          input: { replacementId: 'replacement-1' },
        },
      }),
    ).rejects.toThrow('does not belong to this project manifest')

    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(before)
    expect(retainedReplacementIds).toEqual([])
  })
})
