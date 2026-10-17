import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { EccRuntimeOperation } from '@ecos-studio/shared'
import { launchE2EApp, repoRoot, resolveOutDir, type E2EApp } from './support/launch'
import { prepareDesign, type E2EDesign } from './support/design'
import { createMilestoneShots } from './support/screenshots'
import {
  cancelFlow,
  createBackendProject,
  createDefaultWorkspace,
  importExternalPdk,
  openWorkspaceInUi,
  readOperationLog,
  registerWorkspaceInApp,
  registerWorkspaceRoot,
  runFlow,
  waitFlowTerminal,
  waitToolchainReady,
  type WorkspaceJourney,
} from './support/journey'

const FLOW_TIMEOUT_MS = 75 * 60_000

describe('product e2e: concurrent workspace flows', () => {
  let launched: E2EApp | undefined
  let shot: ReturnType<typeof createMilestoneShots>
  let outDir: string
  let design: E2EDesign
  let projectId: string
  let pdkInstallationId: string

  beforeAll(async () => {
    outDir = await resolveOutDir('flow-concurrency')
    await mkdir(join(outDir, 'work'), { recursive: true })
    design = await prepareDesign(join(outDir, 'work'))
    launched = await launchE2EApp(outDir)
    shot = createMilestoneShots(launched.page, outDir)
    await waitToolchainReady(launched.page)
    projectId = await createBackendProject(launched.page, {
      projectRoot: design.projectRoot,
      name: `${design.name}-concurrency-e2e`,
      designName: design.designName,
      rtlImport: design.rtlImport,
    })
    await launched.page.evaluate(
      (projectRoot) =>
        window.ecosDesktop.backendProjectComparison.selectProject({
          projectRootLocator: projectRoot,
        }),
      design.projectRoot,
    )
    pdkInstallationId = await importExternalPdk(
      launched.page,
      process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk'),
    )
    console.log(`concurrency e2e output: ${outDir}; design: ${design.name}`)
  }, 180_000)

  afterEach(async () => {
    if (!launched) return
    const { page } = launched
    const projection = await page.evaluate(() =>
      window.ecosDesktop.ecc.runtime.operationProjection(),
    )
    const cleanup = await Promise.allSettled(
      projection.operations.map(async (operation) => {
        const workspace = {
          projectRoot: design.projectRoot,
          workspaceDir: operation.workspaceDirectory,
          workspaceHandle: operation.workspaceHandle,
          workspaceRevision: operation.workspaceRevision ?? 1,
          designName: design.designName,
        }
        await cancelFlow(page, workspace, operation.operationId)
        await waitFlowTerminal(page, workspace, operation.operationId, 120_000)
      }),
    )
    const failures = cleanup.filter((result) => result.status === 'rejected')
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Concurrent flow cleanup failed',
      )
  }, 180_000)

  afterAll(async () => {
    await launched?.close()
  })

  it.each([
    {
      scenario: 'finish-both',
      description:
        'finishes two flows that overlap in different workspaces of the same project',
    },
    {
      scenario: 'simultaneous-start',
      description: 'starts two flows at the same time',
    },
    {
      scenario: 'cancel-first',
      description: 'cancels one flow without stopping the other',
    },
  ] as const)(
    '$description',
    async ({ scenario }) => {
      const { page } = launched!
      const workspaces: WorkspaceJourney[] = []
      const operations: EccRuntimeOperation[] = []
      try {
        for (const suffix of ['a', 'b']) {
          const workspace = await createDefaultWorkspace(page, {
            ...design,
            projectId,
            pdkInstallationId,
            workspaceName: `${scenario}-${suffix}`,
          })
          workspaces.push(workspace)
          await registerWorkspaceRoot(page, workspace.workspaceDir)
          if (workspaces.length === 1 && scenario === 'finish-both') {
            await openWorkspaceInUi(page, workspace)
          } else {
            await registerWorkspaceInApp(page, workspace)
          }
        }

        if (scenario !== 'simultaneous-start') {
          for (const workspace of workspaces) {
            operations.push(await runFlow(page, workspace))
          }
        } else {
          const starts = await Promise.allSettled(
            workspaces.map((workspace) => runFlow(page, workspace)),
          )
          await writeFile(
            join(outDir, `${scenario}-starts.json`),
            JSON.stringify(
              starts,
              (_, value) => (value instanceof Error ? { message: value.message } : value),
              2,
            ),
          )
          for (const result of starts) {
            if (result.status === 'rejected') throw result.reason
            if (result.status === 'fulfilled') operations.push(result.value)
          }
        }
        expect(new Set(operations.map((operation) => operation.operationId)).size).toBe(2)
        expect(operations[0].workspaceId).not.toBe(operations[1].workspaceId)

        await expect
          .poll(
            async () => {
              const projection = await page.evaluate(() =>
                window.ecosDesktop.ecc.runtime.operationProjection(),
              )
              return operations.map((operation) => {
                const live = projection.operations.find(
                  (candidate) => candidate.operationId === operation.operationId,
                )
                return live?.flow?.steps.some((step) => step.state === 'Ongoing') ?? false
              })
            },
            { timeout: 120_000, interval: 250 },
          )
          .toEqual([true, true])

        const visibleRequest = {
          projectRoot: design.projectRoot,
          workspaceIds: operations.map((operation) => operation.workspaceId),
        }
        await expect
          .poll(
            async () => {
              const visible = await page.evaluate(
                async ({ projectRoot, workspaceIds }) =>
                  window.ecosDesktop.projectManagement.watchWorkspaceFlows({
                    projects: [{ projectRoot, workspaceIds }],
                  }),
                visibleRequest,
              )
              const states = Object.values(visible[design.projectRoot] ?? {})
              return {
                count: states.length,
                ready: states.every(
                  (state) =>
                    Object.keys(state.steps).length > 0 && state.issue !== 'unavailable',
                ),
              }
            },
            { timeout: 30_000, interval: 500 },
          )
          .toEqual({ count: 2, ready: true })

        const overlap = await page.evaluate(() =>
          window.ecosDesktop.ecc.runtime.operationProjection(),
        )
        await writeFile(
          join(outDir, `${scenario}-overlap.json`),
          JSON.stringify(overlap, null, 2),
        )
        console.log(
          `${scenario}: both workspace flows are executing at ${new Date().toISOString()}`,
        )
        await shot(`${scenario}-overlap`)

        if (scenario === 'cancel-first') {
          await cancelFlow(page, workspaces[0], operations[0].operationId)
          const cancelled = await waitFlowTerminal(
            page,
            workspaces[0],
            operations[0].operationId,
            120_000,
          )
          expect(cancelled.state).toBe('cancelled')
          const projection = await page.evaluate(() =>
            window.ecosDesktop.ecc.runtime.operationProjection(),
          )
          expect(
            projection.operations.some(
              (operation) =>
                operation.operationId === operations[1].operationId &&
                operation.state === 'running',
            ),
          ).toBe(true)
          const completedBefore =
            projection.operations
              .find((operation) => operation.operationId === operations[1].operationId)
              ?.flow?.steps.filter((step) => step.state === 'Success').length ?? 0
          await expect
            .poll(
              async () => {
                const current = await page.evaluate(() =>
                  window.ecosDesktop.ecc.runtime.operationProjection(),
                )
                const survivor = current.operations.find(
                  (operation) => operation.operationId === operations[1].operationId,
                )
                return (
                  survivor?.state === 'running' &&
                  (survivor.flow?.steps.filter((step) => step.state === 'Success')
                    .length ?? 0) > completedBefore
                )
              },
              { timeout: 120_000, interval: 250 },
            )
            .toBe(true)
          await writeFile(
            join(outDir, `${scenario}-survivor.json`),
            JSON.stringify(
              await page.evaluate(() =>
                window.ecosDesktop.ecc.runtime.operationProjection(),
              ),
              null,
              2,
            ),
          )
          await cancelFlow(page, workspaces[1], operations[1].operationId)
        } else if (scenario === 'simultaneous-start') {
          await Promise.all(
            operations.map((operation, index) =>
              cancelFlow(page, workspaces[index], operation.operationId),
            ),
          )
        }

        const terminals = await Promise.all(
          operations.map((operation, index) =>
            waitFlowTerminal(
              page,
              workspaces[index],
              operation.operationId,
              FLOW_TIMEOUT_MS,
            ),
          ),
        )
        await writeFile(
          join(outDir, `${scenario}-terminal.json`),
          JSON.stringify(terminals, null, 2),
        )
        expect(terminals.map((operation) => operation.state)).toEqual(
          scenario === 'finish-both'
            ? ['succeeded', 'succeeded']
            : ['cancelled', 'cancelled'],
        )
        const logs = await Promise.all(
          operations.map((operation, index) =>
            readOperationLog(page, workspaces[index], operation.operationId),
          ),
        )
        for (const [index, log] of logs.entries()) {
          expect(log).toContain(`ECC run ${operations[index].operationId} started`)
          expect(log).not.toContain(
            `ECC run ${operations[1 - index].operationId} started`,
          )
        }
      } finally {
        await shot(`${scenario}-final`).catch(() => undefined)
        const projection = await page.evaluate(() =>
          window.ecosDesktop.ecc.runtime.operationProjection(),
        )
        await writeFile(
          join(outDir, `${scenario}-final.json`),
          JSON.stringify(projection, null, 2),
        )
        for (const operation of [...projection.operations, ...projection.outcomes]) {
          const workspace = workspaces.find(
            (item) => item.workspaceDir === operation.workspaceDirectory,
          )
          if (!workspace) continue
          const log = await readOperationLog(
            page,
            workspace,
            operation.operationId,
          ).catch((error) => String(error))
          await writeFile(join(outDir, `${basename(workspace.workspaceDir)}.log`), log)
        }
      }
    },
    FLOW_TIMEOUT_MS + 300_000,
  )
})
