import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchE2EApp, repoRoot, resolveOutDir, type E2EApp } from './support/launch'
import { prepareDesign, type E2EDesign } from './support/design'
import { createMilestoneShots } from './support/screenshots'
import {
  cancelFlow,
  createBackendProject,
  createDefaultWorkspace,
  getVersions,
  importExternalPdk,
  openWorkspaceInUi,
  readOperationLog,
  readOverviewStepStates,
  registerWorkspaceRoot,
  runFlow,
  waitFlowTerminal,
  waitToolchainReady,
  type WorkspaceJourney,
} from './support/journey'

const FLOW_TIMEOUT_MS = Number(process.env.ECOS_E2E_FLOW_TIMEOUT_MS ?? 30 * 60_000)
const PDK_ROOT = process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk')

async function expectedEccVersion(): Promise<string> {
  const pyproject = await readFile(join(repoRoot, 'ecc/pyproject.toml'), 'utf8')
  const version = pyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  if (!version) throw new Error('could not read ecc version from ecc/pyproject.toml')
  // ecc reports its version PEP 440-normalized (0.1.0-alpha.12 → 0.1.0a12).
  return version.replace(
    /-(alpha|beta|rc)\./,
    (_, label) => `${{ alpha: 'a', beta: 'b', rc: 'rc' }[label as string]}`,
  )
}

async function readFlowSteps(
  workspaceDir: string,
): Promise<Array<{ name: string; state: string }>> {
  const flow = JSON.parse(
    await readFile(join(workspaceDir, 'home/flow.json'), 'utf8'),
  ) as {
    steps?: Array<{ name?: string; id?: string; state?: string }>
  }
  return (flow.steps ?? []).map((step) => ({
    name: step.name ?? step.id ?? '?',
    state: step.state ?? '?',
  }))
}

async function readQualityGateFailures(workspaceDir: string): Promise<string[]> {
  const checklist = JSON.parse(
    await readFile(join(workspaceDir, 'home/checklist.json'), 'utf8'),
  ) as {
    checklist?: Array<{
      id?: string
      category?: string
      state?: string
      blocked?: boolean
    }>
  }
  return (checklist.checklist ?? [])
    .filter((item) => item.category === 'quality_gate')
    .filter((item) => item.state !== 'pass' || item.blocked === true)
    .map((item) => item.id ?? '?')
}

describe('product e2e: backend rtl2gds journey', () => {
  let launched: E2EApp | undefined
  let shot: ReturnType<typeof createMilestoneShots>
  let outDir: string
  let design: E2EDesign
  let workspace: WorkspaceJourney | undefined
  let operationId: string | undefined
  let operationTerminal = false

  beforeAll(async () => {
    outDir = await resolveOutDir('rtl2gds')
    await mkdir(join(outDir, 'work'), { recursive: true })
    design = await prepareDesign(join(outDir, 'work'))
    launched = await launchE2EApp(outDir)
    shot = createMilestoneShots(launched.page, outDir)
    console.log(`e2e output directory: ${outDir}; design: ${design.name}`)
  }, 180_000)

  afterAll(async () => {
    if (launched && workspace && operationId && !operationTerminal) {
      await cancelFlow(launched.page, workspace, operationId).catch(() => undefined)
    }
    await launched?.close()
  })

  it('resolves the pinned ECC toolchain', async () => {
    const page = launched!.page
    const status = await waitToolchainReady(page)
    const versions = await getVersions(page)
    const expected = await expectedEccVersion()
    console.log(`toolchain status: ${status}; versions: ${JSON.stringify(versions)}`)
    expect(versions.ecc).toBe(expected)
    await shot('toolchain-ready')
  })

  it('creates a backend project and a default workspace', async () => {
    const page = launched!.page
    const projectId = await createBackendProject(page, {
      projectRoot: design.projectRoot,
      name: `${design.name}-e2e`,
      designName: design.designName,
    })
    const pdkInstallationId = await importExternalPdk(page, PDK_ROOT)
    workspace = await createDefaultWorkspace(page, {
      projectRoot: design.projectRoot,
      projectId,
      designName: design.designName,
      topModule: design.topModule,
      clockPort: design.clockPort,
      frequencyMhz: design.frequencyMhz,
      inputs: design.inputs,
      parameters: design.parameters,
      pdkInstallationId,
    })
    expect(workspace.workspaceDir).toBe(join(design.projectRoot, 'default'))
    await registerWorkspaceRoot(page, workspace.workspaceDir)
    await openWorkspaceInUi(page, workspace)
    await shot('workspace-created', '#/projects')
  }, 180_000)

  it(
    'runs the rtl2gds flow to a terminal state',
    async () => {
      const page = launched!.page
      const operation = await runFlow(page, workspace!)
      operationId = operation.operationId
      await shot('flow-running', '#/workspace/home')
      let terminal
      try {
        terminal = await waitFlowTerminal(page, workspace!, operationId, FLOW_TIMEOUT_MS)
      } catch (error) {
        await cancelFlow(page, workspace!, operationId).catch(() => undefined)
        operationTerminal = true
        await shot('flow-timeout')
        throw error
      }
      operationTerminal = true
      if (terminal.state !== 'succeeded') {
        const log = await readOperationLog(page, workspace!, operationId).catch(() => '')
        if (log) console.error(`operation log tail:\n${log}`)
        await shot('flow-failed')
      }
      expect(terminal.state).toBe('succeeded')
    },
    FLOW_TIMEOUT_MS + 120_000,
  )

  it('reports every step successful with passing quality gates', async () => {
    const page = launched!.page
    const steps = await readOverviewStepStates(page)
    console.log(`overview steps: ${JSON.stringify(steps)}`)
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) {
      expect(step.state.toLowerCase(), `overview step ${step.id}`).toBe('succeeded')
    }

    const fileSteps = await readFlowSteps(workspace!.workspaceDir)
    expect(fileSteps.length).toBeGreaterThan(0)
    for (const step of fileSteps) {
      expect(step.state, `flow.json step ${step.name}`).toBe('Success')
    }

    const gateFailures = await readQualityGateFailures(workspace!.workspaceDir)
    expect(gateFailures, `quality_gate failures: ${gateFailures.join(', ')}`).toEqual([])
    await shot('flow-success', '#/workspace/home')
  }, 120_000)

  it('passes the signoff-lit artifact gate', () => {
    const suite = process.env.ECOS_E2E_LIT_SUITE
    if (!suite) {
      console.log('ECOS_E2E_LIT_SUITE unset; skipping the signoff-lit gate')
      return
    }
    const litCase = join(suite, design.name, `${design.name}.lit`)
    if (!existsSync(litCase)) {
      console.log(`no lit case for design ${design.name}; skipping the signoff-lit gate`)
      return
    }
    const result = spawnSync(
      'bash',
      [join(repoRoot, 'ecc/nix/scripts/signoff-lit.sh'), suite, '--filter', design.name],
      {
        env: {
          ...process.env,
          ECC_REPO_ROOT: join(repoRoot, 'ecc'),
          ECC_FLOW_WORKSPACES: join(outDir, 'work'),
        },
        encoding: 'utf8',
      },
    )
    if (result.status !== 0) {
      console.error(`signoff-lit stdout:\n${result.stdout}`)
      console.error(`signoff-lit stderr:\n${result.stderr}`)
      if (result.error) console.error(`signoff-lit spawn error: ${result.error.message}`)
    }
    expect(result.status).toBe(0)
  }, 300_000)
})
