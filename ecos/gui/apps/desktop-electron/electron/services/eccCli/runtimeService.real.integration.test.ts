import type { EccRuntimeOperation, EccWorkspaceCreateRequest } from '@ecos-studio/shared'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { EccCliRuntimeService } from './runtimeService'
import { projectNeedsCliMigration } from './legacyMigration'

const enabled = process.env.ECOS_REAL_ECC_INTEGRATION === '1'
const describeReal = enabled ? describe : describe.skip

describeReal('ECC CLI runtime real integration', () => {
  const services: EccCliRuntimeService[] = []
  let testRoot = ''

  afterAll(async () => {
    await Promise.allSettled(services.map((service) => service.shutdown()))
    if (testRoot && process.env.ECOS_REAL_ECC_KEEP !== '1') {
      await rm(testRoot, { force: true, recursive: true })
    }
  })

  it('executes the backend GUI project and workspace lifecycle through ECC CLI', async () => {
    const wrapper = requiredPath('ECOS_REAL_ECC_WRAPPER')
    const pdkRoot = requiredPath('ECOS_REAL_PDK_ROOT')
    const rtl = requiredPath('ECOS_REAL_RTL')
    const parent = requiredPath('ECOS_REAL_TEST_PARENT')
    await Promise.all([access(wrapper), access(pdkRoot), access(rtl), access(parent)])

    testRoot = await mkdtemp(join(parent, 'ecos-gui-cli-integration.'))
    const projectRoot = join(testRoot, 'project')
    const workspaceRoot = join(projectRoot, 'ws_0001')
    const service = createService(wrapper)
    services.push(service)

    const createdProject = await service.mutateProjectManifest(projectRoot, {
      designName: 'gcd',
      name: 'GUI CLI Integration',
      projectType: 'backend',
      type: 'create',
    })
    expect(createdProject.root_path).toBe(resolve(projectRoot))
    expect(createdProject.workspaces).toEqual([])

    const catalog = await service.describeWorkspaceSpec()
    expect(catalog.flowDefinitions).toEqual(
      expect.arrayContaining([expect.objectContaining({ flowId: 'rtl2gds' })]),
    )

    const request = workspaceRequest(projectRoot, workspaceRoot, pdkRoot, rtl)
    const created = await service.createWorkspace(request)
    expect(created).toMatchObject({
      directory: workspaceRoot,
      workspaceId: 'ws_0001',
    })
    expect(created.reused).not.toBe(true)

    const reused = await service.openWorkspace({ directory: workspaceRoot })
    expect(reused).toMatchObject({
      directory: workspaceRoot,
      reused: true,
      workspaceHandle: created.workspaceHandle,
    })
    const discovered = await service.discoverProject(workspaceRoot)
    expect(discovered).toMatchObject({ projectRoot })

    await service.applyProjectSettings(projectRoot, ['design.frequency_mhz=110'], [])
    let current = await service.workspaceSession(created.workspaceHandle)
    const currentRevision = requiredRevision(current)
    const refreshed = await service.refreshConfig({
      expectedWorkspaceRevision: currentRevision,
      force: false,
      workspaceHandle: current.workspaceHandle,
    })
    const refreshedRevision = requiredRevision(refreshed)
    expect(refreshedRevision).toBeGreaterThan(currentRevision)

    const updated = await service.updateWorkspaceConfiguration({
      commandId: randomUUID(),
      configuration: {
        design: {},
        parameters: { 'design.frequency_mhz': 125 },
        pdk: {},
      },
      expectedWorkspaceRevision: refreshedRevision,
      workspaceHandle: created.workspaceHandle,
    })
    const updatedRevision = requiredRevision(updated)
    expect(updatedRevision).toBeGreaterThan(refreshedRevision)
    const synthesisConfiguration = await service.readWorkspaceStepConfiguration({
      step: 'synthesis',
      workspaceHandle: created.workspaceHandle,
    })
    expect(synthesisConfiguration).toMatchObject({ status: 'available' })
    if (synthesisConfiguration.status !== 'available') {
      throw new Error('Synthesis configuration is unavailable')
    }
    expect(
      synthesisConfiguration.parameters.find(
        (parameter) => parameter.param === 'design.frequency_mhz',
      )?.value,
    ).toBe(125)

    const managedRefresh = await service.updateWorkspace({
      commandId: randomUUID(),
      expectedWorkspaceRevision: updatedRevision,
      workspaceBindings: request.workspaceBindings,
      workspaceHandle: created.workspaceHandle,
      workspaceSpec: request.workspaceSpec,
    })
    const managedRevision = requiredRevision(managedRefresh)
    expect(managedRevision).toBeGreaterThan(updatedRevision)

    current = await runFlow(service, created.workspaceHandle, managedRevision, false)
    current = await runFlow(
      service,
      created.workspaceHandle,
      requiredRevision(current),
      true,
    )
    const stepOperation = await service.startStepOperation({
      expectedWorkspaceRevision: requiredRevision(current),
      idempotencyKey: randomUUID(),
      rerun: true,
      step: 'synthesis',
      workspaceHandle: created.workspaceHandle,
    })
    await expectSucceeded(service, created.workspaceHandle, stepOperation)
    current = await service.workspaceSession(created.workspaceHandle)

    const revisionBeforeReset = requiredRevision(current)
    const reset = await service.resetFlow({
      expectedWorkspaceRevision: revisionBeforeReset,
      workspaceHandle: created.workspaceHandle,
    })
    expect(requiredRevision(reset)).toBeGreaterThan(revisionBeforeReset)

    const secondRoot = join(projectRoot, 'ws_0002')
    const second = await service.createWorkspace(
      workspaceRequest(projectRoot, secondRoot, pdkRoot, rtl, 'ws-2'),
    )
    expect(second.workspaceId).toBe('ws_0002')
    await service.closeWorkspace({ workspaceHandle: second.workspaceHandle })
    const afterDelete = await service.mutateProjectManifest(projectRoot, {
      deleteDirectory: true,
      type: 'delete-workspace',
      workspaceId: second.workspaceId,
    })
    expect(afterDelete.workspaces.map((workspace) => workspace.workspace_id)).toEqual([
      'ws_0001',
    ])
    await expect(access(secondRoot)).rejects.toThrow(/ENOENT/)

    await service.closeWorkspace({ workspaceHandle: created.workspaceHandle })
    await service.shutdown()

    const legacyRoot = join(projectRoot, 'runs', 'ws_0001')
    await mkdir(join(projectRoot, 'runs'), { recursive: true })
    await rename(workspaceRoot, legacyRoot)
    const manifestPath = join(projectRoot, 'project.json')
    const legacyManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    legacyManifest.root_path = '/legacy/location/project'
    legacyManifest.workspaces[0].workspace_path = 'runs/ws_0001'
    await writeFile(manifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`)
    expect(await projectNeedsCliMigration(projectRoot)).toBe(true)

    const restarted = createService(wrapper)
    services.push(restarted)
    const migrated = await restarted.openWorkspace({ directory: legacyRoot })
    expect(migrated).toMatchObject({
      directory: workspaceRoot,
      workspaceId: 'ws_0001',
    })
    await expect(access(legacyRoot)).rejects.toThrow(/ENOENT/)
    await access(workspaceRoot)
    const migratedManifest = await restarted.loadProjectManifest(projectRoot)
    expect(migratedManifest).toMatchObject({
      root_path: projectRoot,
      workspaces: [
        expect.objectContaining({
          workspace_id: 'ws_0001',
          workspace_path: workspaceRoot,
        }),
      ],
    })
  }, 240_000)
})

function createService(wrapper: string): EccCliRuntimeService {
  return new EccCliRuntimeService({
    envProvider: () => ({ ...process.env, ELECTRON_RUN_AS_NODE: undefined }),
    resolveLaunch: () => ({ command: wrapper }),
    runtimeId: 'ecos-gui-real-integration',
  })
}

function workspaceRequest(
  projectRoot: string,
  targetDirectory: string,
  pdkRoot: string,
  rtl: string,
  commandId = 'ws-1',
): EccWorkspaceCreateRequest {
  return {
    commandId,
    projectMode: 'select',
    projectName: 'GUI CLI Integration',
    projectRoot,
    targetDirectory,
    workspaceBindings: { inputs: { rtl }, pdk: { root: pdkRoot } },
    workspaceSpec: {
      design: { clockPort: 'clk', name: 'gcd', topModule: 'gcd' },
      flow: {
        flowId: 'syn_sta',
        fromStepId: 'synthesis',
        throughStepId: 'synthesis',
      },
      inputs: [{ inputId: 'rtl', role: 'rtl' }],
      parameters: { 'design.frequency_mhz': 100 },
      pdk: { familyId: 'ics55' },
    },
  }
}

async function runFlow(
  service: EccCliRuntimeService,
  workspaceHandle: string,
  expectedWorkspaceRevision: number,
  rerun: boolean,
) {
  const operation = await service.startFlowOperation({
    expectedWorkspaceRevision,
    idempotencyKey: randomUUID(),
    rerun,
    workspaceHandle,
  })
  await expectSucceeded(service, workspaceHandle, operation)
  return await service.workspaceSession(workspaceHandle)
}

async function expectSucceeded(
  service: EccCliRuntimeService,
  workspaceHandle: string,
  operation: EccRuntimeOperation,
): Promise<void> {
  const terminal = await service.waitForOperation({
    operationId: operation.operationId,
    workspaceHandle,
  })
  if (terminal.state !== 'succeeded') {
    const log = await service
      .operationLog({ operationId: operation.operationId, workspaceHandle })
      .then((result) => result.content)
      .catch(() => '')
    throw new Error(`ECC operation ${operation.operationId} ${terminal.state}:\n${log}`)
  }
}

function requiredPath(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the real ECC integration test`)
  return resolve(value)
}

function requiredRevision(value: { workspaceRevision?: number }): number {
  if (!Number.isInteger(value.workspaceRevision) || Number(value.workspaceRevision) < 1) {
    throw new Error('Workspace revision is unavailable')
  }
  return Number(value.workspaceRevision)
}
