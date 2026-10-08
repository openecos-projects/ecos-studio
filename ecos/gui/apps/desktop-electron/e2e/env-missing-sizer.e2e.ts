import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { constants } from 'node:fs'
import { accessSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { launchE2EApp, repoRoot, resolveOutDir, type E2EApp } from './support/launch'
import { prepareGcdProject, type E2EDesign } from './support/design'
import { createMilestoneShots } from './support/screenshots'
import {
  readOperationLog,
  readOverviewStepStates,
  runFlow,
  setupBackendWorkspace,
  waitFlowTerminal,
  type WorkspaceJourney,
} from './support/journey'

const FLOW_TIMEOUT_MS = Number(process.env.ECOS_E2E_FLOW_TIMEOUT_MS ?? 15 * 60_000)
const PDK_ROOT = process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk')

/**
 * Strip every Sizer discovery route (env root + any PATH dir shipping Sizer).
 * PATH dirs that contain Sizer also ship unrelated tools (uv lives next to
 * Sizer in ~/.local/bin), so each offending dir is replaced by a shadow dir
 * symlinking everything except Sizer instead of dropping the dir outright.
 */
function dropSizer(env: Record<string, string>, shadowRoot: string): void {
  delete env.CHIPCOMPILER_ECC_SIZER_ROOT
  let shadowCount = 0
  env.PATH = (env.PATH ?? '')
    .split(':')
    .map((entry) => {
      try {
        accessSync(join(entry, 'Sizer'), constants.X_OK)
      } catch {
        return entry
      }
      const shadow = join(shadowRoot, `path-${shadowCount++}`)
      mkdirSync(shadow, { recursive: true })
      for (const name of readdirSync(entry)) {
        if (name === 'Sizer') continue
        symlinkSync(join(entry, name), join(shadow, name))
      }
      return shadow
    })
    .join(':')
}

describe('product e2e: rtl2gds without Sizer fails cleanly', () => {
  let launched: E2EApp | undefined
  let shot: ReturnType<typeof createMilestoneShots>
  let design: E2EDesign
  let workspace: WorkspaceJourney | undefined

  beforeAll(async () => {
    const outDir = await resolveOutDir('no-sizer')
    await mkdir(join(outDir, 'work'), { recursive: true })
    design = await prepareGcdProject(join(outDir, 'work'))
    launched = await launchE2EApp(outDir, {
      adjustEnv: (env) => dropSizer(env, join(outDir, 'path-shadow')),
    })
    shot = createMilestoneShots(launched.page, outDir)
    console.log(`e2e output directory: ${outDir}; design: ${design.name}`)
  }, 180_000)

  afterAll(async () => {
    await launched?.close()
  })

  it(
    'fails the flow at Timing optimization with a visible, actionable error',
    async () => {
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
      const terminal = await waitFlowTerminal(
        page,
        workspace,
        operation.operationId,
        FLOW_TIMEOUT_MS,
      )
      const log = await readOperationLog(page, workspace, operation.operationId).catch(
        () => '',
      )
      if (log) console.log(`operation log tail:\n${log}`)
      await shot('flow-failed-sizer-missing', '#/workspace/home')

      expect(terminal.state).toBe('failed')
      expect(log).toMatch(/sizer/i)

      const steps = await readOverviewStepStates(page)
      console.log(`overview steps: ${JSON.stringify(steps)}`)
      const timing = steps.find((step) => /timing/i.test(step.id))
      expect(timing?.state.toLowerCase(), `steps: ${JSON.stringify(steps)}`).not.toBe(
        'succeeded',
      )

      // The app stays usable after the failure.
      const versions = await page.evaluate(() => window.ecosDesktop.app.getVersions())
      expect(versions.ecc).toBeTruthy()
    },
    FLOW_TIMEOUT_MS + 180_000,
  )
})
