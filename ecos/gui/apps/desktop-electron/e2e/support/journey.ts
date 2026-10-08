import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import type { EccRuntimeOperation, EccWorkspaceCreateRequest } from '@ecos-studio/shared'
import './bridge'

export interface WorkspaceJourney {
  projectRoot: string
  workspaceDir: string
  workspaceHandle: string
  workspaceRevision: number
}

export async function getVersions(
  page: Page,
): Promise<Record<string, string | undefined>> {
  return page.evaluate(() => window.ecosDesktop.app.getVersions())
}

/** Ready = dev-wrapper (repo source runtime) or ready (installed/external bundle). */
export async function waitToolchainReady(
  page: Page,
  timeoutMs = 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const state = await page.evaluate(() => window.ecosDesktop.cliInstaller.getStatus())
    if (state.status === 'ready' || state.status === 'dev-wrapper') return state.status
    if (state.status !== 'installing' && state.status !== 'not-installed') {
      throw new Error(`ECC toolchain not ready: ${state.status} ${state.error ?? ''}`)
    }
    if (Date.now() > deadline) {
      throw new Error(
        `ECC toolchain not ready within ${timeoutMs}ms (status: ${state.status})`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

export async function importExternalPdk(page: Page, root: string): Promise<string> {
  const snapshot = await page.evaluate(
    (request) => window.ecosDesktop.pdkInventory.import(request),
    { root, familyId: 'ics55', displayName: 'ICS55 (e2e)' },
  )
  if (!snapshot.id) {
    throw new Error(
      `PDK import produced no installation id (readiness: ${snapshot.readiness ?? 'unknown'})`,
    )
  }
  return snapshot.id
}

export async function createBackendProject(
  page: Page,
  input: { projectRoot: string; name: string; designName: string },
): Promise<string> {
  await page.evaluate((request) => window.ecosDesktop.projectManifest.mutate(request), {
    projectRoot: input.projectRoot,
    mutation: {
      type: 'create',
      name: input.name,
      designName: input.designName,
      projectType: 'backend',
      mpc: null,
    },
  })
  const manifest = await page.evaluate(
    (root) => window.ecosDesktop.projectManagement.readManifest(root),
    input.projectRoot,
  )
  if (!manifest?.project_id) {
    throw new Error('project manifest missing project_id after create')
  }
  return manifest.project_id
}

export interface CreateWorkspaceInput {
  projectRoot: string
  projectId: string
  designName: string
  topModule: string
  clockPort: string
  frequencyMhz: number
  inputs: Array<{ inputId: string; role: string; path: string }>
  parameters: Record<string, unknown>
  pdkInstallationId: string
}

/**
 * Create the e2e workspace as <projectRoot>/default so produced workspaces
 * satisfy the signoff-lit layout (<name>/default/home/flow.json).
 */
export async function createDefaultWorkspace(
  page: Page,
  input: CreateWorkspaceInput,
): Promise<WorkspaceJourney> {
  const targetDirectory = join(input.projectRoot, 'default')
  const payload: EccWorkspaceCreateRequest = {
    commandId: randomUUID(),
    targetDirectory,
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    pdkInstallationId: input.pdkInstallationId,
    pdkRequirement: { familyId: 'ics55', version: null, manualConfig: null },
    workspaceBindings: {
      inputs: Object.fromEntries(input.inputs.map((i) => [i.inputId, i.path])),
      pdk: { root: '' },
    },
    workspaceSpec: {
      schemaVersion: 1,
      design: {
        name: input.designName,
        topModule: input.topModule,
        clockPort: input.clockPort,
      },
      inputMode: 'rtl',
      inputs: input.inputs.map(({ inputId, role }) => ({ inputId, role })),
      pdk: { familyId: 'ics55', mode: 'default' },
      flow: { flowId: 'rtl2gds' },
      parameters: {
        'design.frequency_mhz': input.frequencyMhz,
        ...input.parameters,
      },
    },
  }
  const result = (await page.evaluate(
    (request) => window.ecosDesktop.productCommands.execute(request),
    { command: 'workspace.create', payload },
  )) as { directory?: string; workspaceHandle?: string; workspaceRevision?: number }
  if (!result.directory || !result.workspaceHandle) {
    throw new Error(
      `workspace.create returned an incomplete result: ${JSON.stringify(result)}`,
    )
  }
  return {
    projectRoot: input.projectRoot,
    workspaceDir: result.directory,
    workspaceHandle: result.workspaceHandle,
    workspaceRevision: result.workspaceRevision ?? 1,
  }
}

export async function registerWorkspaceRoot(
  page: Page,
  workspaceDir: string,
): Promise<void> {
  await page.evaluate(
    (path) => window.ecosDesktop.workspace.registerProjectRoot(path),
    workspaceDir,
  )
}

/** Toolchain → PDK import → project → default workspace → register root. */
export async function setupBackendWorkspace(
  page: Page,
  input: Omit<CreateWorkspaceInput, 'projectId' | 'pdkInstallationId'> & {
    pdkRoot: string
  },
): Promise<WorkspaceJourney> {
  await waitToolchainReady(page)
  const projectId = await createBackendProject(page, {
    projectRoot: input.projectRoot,
    name: `${input.designName}-e2e`,
    designName: input.designName,
  })
  const pdkInstallationId = await importExternalPdk(page, input.pdkRoot)
  const workspace = await createDefaultWorkspace(page, {
    ...input,
    projectId,
    pdkInstallationId,
  })
  await registerWorkspaceRoot(page, workspace.workspaceDir)
  return workspace
}

export async function runFlow(
  page: Page,
  ws: WorkspaceJourney,
): Promise<EccRuntimeOperation> {
  const operation = (await page.evaluate(
    (request) => window.ecosDesktop.productCommands.execute(request),
    {
      command: 'workspace.run',
      payload: {
        workspaceHandle: ws.workspaceHandle,
        expectedWorkspaceRevision: ws.workspaceRevision,
        idempotencyKey: randomUUID(),
        rerun: false,
      },
    },
  )) as EccRuntimeOperation
  if (!operation.operationId) {
    throw new Error(`workspace.run returned no operationId: ${JSON.stringify(operation)}`)
  }
  return operation
}

export async function waitFlowTerminal(
  page: Page,
  ws: WorkspaceJourney,
  operationId: string,
  timeoutMs: number,
): Promise<EccRuntimeOperation> {
  const wait = page.evaluate(
    (request) => window.ecosDesktop.ecc.runtime.waitForOperation(request),
    { workspaceHandle: ws.workspaceHandle, operationId },
  ) as Promise<EccRuntimeOperation>
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`flow did not reach a terminal state within ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([wait, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

export async function cancelFlow(
  page: Page,
  ws: WorkspaceJourney,
  operationId: string,
): Promise<void> {
  await page.evaluate((request) => window.ecosDesktop.productCommands.execute(request), {
    command: 'workspace.cancel',
    payload: { workspaceHandle: ws.workspaceHandle, operationId },
  })
}

export async function readOperationLog(
  page: Page,
  ws: WorkspaceJourney,
  operationId: string,
): Promise<string> {
  const result = await page.evaluate(
    (request) => window.ecosDesktop.ecc.runtime.operationLog(request),
    { workspaceHandle: ws.workspaceHandle, operationId },
  )
  return result.content
}

interface OverviewStep {
  stepId?: string
  state?: string
}

/** Steps as reported by the app-level overview contract (driver seam). */
export async function readOverviewStepStates(
  page: Page,
): Promise<Array<{ id: string; state: string }>> {
  const result = (await page.evaluate(() =>
    window.ecosDesktop.backendWorkspace.refreshOverview(),
  )) as { overview?: { flow?: { data?: { steps?: OverviewStep[] } } } }
  const steps = result.overview?.flow?.data?.steps ?? []
  return steps.map((step) => ({ id: step.stepId ?? '?', state: step.state ?? '?' }))
}
