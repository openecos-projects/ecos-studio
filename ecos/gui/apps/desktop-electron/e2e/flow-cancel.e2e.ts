import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { launchE2EApp, repoRoot, resolveOutDir, type E2EApp } from './support/launch'
import { prepareDesign, type E2EDesign } from './support/design'
import { createMilestoneShots } from './support/screenshots'
import {
  cancelFlow,
  getVersions,
  runFlow,
  setupBackendWorkspace,
  waitFlowTerminal,
  type WorkspaceJourney,
} from './support/journey'

const PDK_ROOT = process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk')

describe('product e2e: cancelling a running flow', () => {
  let launched: E2EApp | undefined
  let shot: ReturnType<typeof createMilestoneShots>
  let design: E2EDesign
  let workspace: WorkspaceJourney | undefined
  let operationId: string | undefined
  let operationTerminal = false

  beforeAll(async () => {
    const outDir = await resolveOutDir('flow-cancel')
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

  it('reaches a cancelled terminal state and keeps the app usable', async () => {
    const page = launched!.page
    workspace = await setupBackendWorkspace(page, {
      projectRoot: design.projectRoot,
      designName: design.designName,
      topModule: design.topModule,
      clockPort: design.clockPort,
      frequencyMhz: design.frequencyMhz,
      inputs: design.inputs,
      parameters: design.parameters,
      pdkRoot: PDK_ROOT,
    })
    const operation = await runFlow(page, workspace)
    operationId = operation.operationId
    await shot('flow-started', '#/workspace/home')

    // Give the runtime a moment to actually start executing before cancelling.
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    await cancelFlow(page, workspace, operationId)
    const terminal = await waitFlowTerminal(page, workspace, operationId, 120_000)
    operationTerminal = true
    await shot('flow-cancelled', '#/workspace/home')

    expect(terminal.state).toBe('cancelled')

    const versions = await getVersions(page)
    expect(versions.ecc).toBeTruthy()
  }, 420_000)
})
