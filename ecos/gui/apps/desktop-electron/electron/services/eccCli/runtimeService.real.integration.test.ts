import type { EccRuntimeOperation, EccWorkspaceCreateRequest } from '@ecos-studio/shared'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { EccCliRuntimeService } from './runtimeService'

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

    const flowPath = join(workspaceRoot, 'home', 'flow.json')
    const originalFlow = await readFile(flowPath, 'utf8')
    const replayKey = 'a'.repeat(64)
    const replay = await service.deriveCalibrationReplay(
      created.workspaceHandle,
      replayKey,
    )
    expect(replay.directory).toBe(join(projectRoot, `calibration-${replayKey}`))
    const replayOperation = await service.startFlowOperation({
      expectedWorkspaceRevision: replay.workspaceRevision,
      idempotencyKey: randomUUID(),
      rerun: true,
      workspaceHandle: replay.workspaceHandle,
    })
    await expectSucceeded(service, replay.workspaceHandle, replayOperation)
    expect(
      await service.deriveCalibrationReplay(created.workspaceHandle, replayKey),
    ).toMatchObject({ workspaceHandle: replay.workspaceHandle })
    expect(await readFile(flowPath, 'utf8')).toBe(originalFlow)
    await service.releaseCalibrationReplay(created.workspaceHandle, replayKey)
    await service.releaseCalibrationReplay(created.workspaceHandle, replayKey)
    await expect(access(replay.directory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(service.workspaceSession(replay.workspaceHandle)).rejects.toThrow(
      'Workspace Session is not open',
    )
    expect((await service.readProjectManifest(projectRoot)).workspaces).toHaveLength(1)

    const orphanKey = 'b'.repeat(64)
    const orphan = await service.deriveCalibrationReplay(
      created.workspaceHandle,
      orphanKey,
    )
    await service.closeWorkspace({ workspaceHandle: orphan.workspaceHandle })
    const reopenedService = createService(wrapper)
    services.push(reopenedService)
    const reopened = await reopenedService.openWorkspace({ directory: workspaceRoot })
    await reopenedService.releaseCalibrationReplay(reopened.workspaceHandle, orphanKey)
    await expect(access(orphan.directory)).rejects.toMatchObject({ code: 'ENOENT' })

    const sameNameKey = 'c'.repeat(64)
    const sameName = await service.deriveWorkspace({
      commandId: randomUUID(),
      directory: workspaceRoot,
      resetFromStep: '',
      targetDirectory: join(projectRoot, `calibration-${sameNameKey}`),
      workspaceHandle: created.workspaceHandle,
    })
    await expect(
      service.releaseCalibrationReplay(created.workspaceHandle, sameNameKey),
    ).rejects.toThrow('Workspace was not created by this calibration replay')
    await expect(access(sameName.directory)).resolves.toBeUndefined()
    await service.closeWorkspace({ workspaceHandle: sameName.workspaceHandle })
    await service.mutateProjectManifest(projectRoot, {
      deleteDirectory: true,
      type: 'delete-workspace',
      workspaceId: sameName.workspaceId!,
    })

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

    const updateConfiguration = (parameters: Record<string, unknown>) =>
      service.updateWorkspaceConfiguration({
        commandId: randomUUID(),
        configuration: { design: {}, parameters, pdk: {} },
        expectedWorkspaceRevision: refreshedRevision,
        workspaceHandle: created.workspaceHandle,
      })
    await expect(updateConfiguration({ 'design.frequency_mhz': 125 })).rejects.toThrow(
      'fixed at 100 MHz by primary_clocks',
    )
    const updated = await updateConfiguration({ 'flow.run_analysis': false })
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
        (parameter) => parameter.param === 'flow.run_analysis',
      )?.value,
    ).toBe(false)

    const configuration = await service.readWorkspaceConfiguration(workspaceRoot)
    const managedRefresh = await service.updateWorkspace({
      commandId: randomUUID(),
      expectedWorkspaceRevision: updatedRevision,
      workspaceBindings: configuration.workspaceBindings,
      workspaceHandle: created.workspaceHandle,
      workspaceSpec: {
        ...request.workspaceSpec,
        inputs: configuration.workspaceSpec.inputs,
      },
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

    const forked = await service.deriveWorkspace({
      directory: workspaceRoot,
      targetDirectory: join(projectRoot, 'reviewed-rerun'),
      resetFromStep: 'synthesis',
      workspaceHandle: created.workspaceHandle,
    })
    const original = await service.workspaceSnapshot({
      workspaceHandle: created.workspaceHandle,
    })
    const fork = await service.workspaceSnapshot({
      workspaceHandle: forked.workspaceHandle,
    })
    expect(original.flow.steps[0]?.state).toBe('Success')
    expect(fork.flow.steps[0]?.state).toBe('Unstart')
    await service.closeWorkspace({ workspaceHandle: forked.workspaceHandle })
    await service.mutateProjectManifest(projectRoot, {
      deleteDirectory: true,
      type: 'delete-workspace',
      workspaceId: 'reviewed-rerun',
    })

    const revisionBeforeReset = requiredRevision(current)
    const reset = await service.resetFlow({
      expectedWorkspaceRevision: revisionBeforeReset,
      workspaceHandle: created.workspaceHandle,
    })
    expect(requiredRevision(reset)).toBeGreaterThan(revisionBeforeReset)

    const secondRoot = join(projectRoot, 'ws_0002')
    const second = await service.createWorkspace(
      // The project already imported its design RTL with the first create;
      // this workspace reuses it (no rtl input).
      workspaceRequest(projectRoot, secondRoot, pdkRoot, undefined, 'ws-2'),
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

    await service.agentWorkspaceSession(created.workspaceHandle)
    await service.closeWorkspace({ workspaceHandle: created.workspaceHandle })
    const rebound = await service.agentWorkspaceSession(created.workspaceHandle)
    expect(rebound.workspaceId).toBe(created.workspaceId)
    expect(rebound.workspaceHandle).not.toBe(created.workspaceHandle)
    await service.shutdown()

    const restarted = createService(wrapper)
    services.push(restarted)
    expect(await restarted.openWorkspace({ directory: workspaceRoot })).toMatchObject({
      directory: workspaceRoot,
      workspaceId: 'ws_0001',
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
  rtl?: string,
  commandId = 'ws-1',
): EccWorkspaceCreateRequest {
  // A fresh project passes the RTL source once (imported into the project
  // rtl/ folder); later workspaces in the same project reuse it.
  const rtlInputs = rtl ? [{ inputId: 'rtl', role: 'rtl' }] : []
  const rtlBindings = rtl ? { rtl } : {}
  return {
    commandId,
    projectMode: 'select',
    projectName: 'GUI CLI Integration',
    projectRoot,
    targetDirectory,
    workspaceBindings: { inputs: rtlBindings, pdk: { root: pdkRoot } },
    workspaceSpec: {
      design: { clockPort: 'clk', name: 'gcd', topModule: 'gcd' },
      flow: {
        flowId: 'syn_sta',
        fromStepId: 'synthesis',
        throughStepId: 'synthesis',
      },
      inputs: rtlInputs,
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
