import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import type {
  EccRuntimeOperation,
  EccWorkspaceCreateRequest,
  EccWorkspaceCreateResult,
} from '@ecos-studio/shared'
import './bridge'

export interface WorkspaceJourney {
  projectRoot: string
  workspaceDir: string
  workspaceHandle: string
  workspaceRevision: number
  creationId?: string
  designName: string
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
  )) as EccWorkspaceCreateResult
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
    creationId: result.creationId,
    designName: input.designName,
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

/**
 * Perform the renderer-side bookkeeping the creation wizard would have done
 * (recent-Workspaces entry + creation journal completion), then open the
 * workspace through the real Project Management "Open" action. This drives
 * useWorkspace.openProject so currentProject, the workspace session, and the
 * dashboard panels are live — without it the UI renders empty placeholder
 * views and milestone screenshots carry no evidence.
 */
export async function openWorkspaceInUi(page: Page, ws: WorkspaceJourney): Promise<void> {
  await page.evaluate(
    async ({ workspaceDir, creationId }) => {
      const entry = {
        designTool: 'backend',
        id: workspaceDir,
        lastOpened: new Date().toISOString(),
        name: workspaceDir.split('/').filter(Boolean).pop() ?? workspaceDir,
        path: workspaceDir,
      }
      const existing: unknown = await window.ecosDesktop.settings.get('recent_projects')
      const kept = Array.isArray(existing)
        ? existing.filter(
            (item) =>
              !item ||
              typeof item !== 'object' ||
              (item as { path?: unknown }).path !== workspaceDir,
          )
        : []
      await window.ecosDesktop.settings.set('recent_projects', [entry, ...kept])
      if (creationId) {
        await window.ecosDesktop.productCommands.execute({
          command: 'workspace.completeCreation',
          payload: { creationId },
        })
      }
    },
    { workspaceDir: ws.workspaceDir, creationId: ws.creationId },
  )

  // Project Management loads its list on mount (migrating recent_projects on
  // first run), so a fresh navigation makes the created workspace visible.
  await page.evaluate(() => {
    window.location.hash = '#/projects'
  })
  const openButton = page.locator('button[aria-label^="Open workspace"]').first()
  await openButton.waitFor({ state: 'visible', timeout: 60_000 })
  await openButton.click()
  await page.waitForFunction(
    () => window.location.hash.startsWith('#/workspace/home'),
    undefined,
    { timeout: 60_000 },
  )

  // Wait until the dashboard has mounted and shows live workspace data: flow
  // steps through the same overview seam the Flow status panel reads, and the
  // design parameters in Chip Basic Info.
  await page.locator('.home-dashboard').waitFor({ state: 'visible', timeout: 60_000 })
  const deadline = Date.now() + 120_000
  for (;;) {
    const steps = await readOverviewStepStates(page).catch(() => [])
    if (steps.length > 0) break
    if (Date.now() > deadline) {
      throw new Error('workspace dashboard did not report flow steps within 120s')
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  await page.waitForFunction(
    (name) =>
      document.querySelector('.home-dashboard')?.textContent?.includes(name) ?? false,
    ws.designName,
    { timeout: 60_000 },
  )
}

/** Toolchain → PDK import → project → default workspace → open it in the UI. */
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
  await openWorkspaceInUi(page, workspace)
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
