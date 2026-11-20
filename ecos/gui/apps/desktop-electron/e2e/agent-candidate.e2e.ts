import { createHash, randomUUID } from 'node:crypto'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  EccCandidateRerunRequest,
  EccRuntimeOperation,
  EccWorkspaceOpenResult,
} from '@ecos-studio/shared'
import { expect, it } from 'vitest'
import { launchE2EApp, resolveOutDir } from './support/launch'

const fixture = process.env.ECOS_E2E_CANDIDATE_PROJECT

it.runIf(Boolean(fixture))(
  'runs an isolated candidate through the real Electron bridge',
  async () => {
    const out = await resolveOutDir('agent-candidate')
    const project = join(out, 'project')
    await cp(fixture!, project, { recursive: true })
    const manifestPath = join(project, 'project.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.root_path = project
    const workspace = join(project, 'default')
    expect(
      manifest.workspaces.map((entry: { workspace_id: string }) => entry.workspace_id),
    ).toEqual(['default'])
    manifest.workspaces[0].workspace_path = workspace
    await writeFile(manifestPath, JSON.stringify(manifest))

    const launched = await launchE2EApp(out)
    try {
      const page = launched.page
      const opened = (await page.evaluate(
        (directory) =>
          window.ecosDesktop.runtime.workspace.open({
            designTool: 'backend',
            directory,
          }),
        workspace,
      )) as EccWorkspaceOpenResult
      const handle = opened.workspaceHandle
      const capabilities = await page.evaluate(
        (workspaceHandle) =>
          window.ecosDesktop.productCommands.execute({
            command: 'candidate.capabilities',
            payload: { workspaceHandle },
          }),
        handle,
      )
      expect(capabilities).toMatchObject({
        targets: expect.arrayContaining([
          expect.objectContaining({
            target_step: 'placement',
            candidate_generation: true,
          }),
        ]),
      })

      const flow = join(workspace, 'home', 'flow.json')
      const initial = await readFile(flow, 'utf8')
      const run = (payload: EccCandidateRerunRequest) =>
        page.evaluate(
          (request) =>
            window.ecosDesktop.productCommands.execute({
              command: 'candidate.rerun',
              payload: request,
            }),
          payload,
        ) as Promise<EccRuntimeOperation>
      const wait = (operationId: string) =>
        page.evaluate(
          (request) => window.ecosDesktop.ecc.runtime!.waitForOperation(request),
          { workspaceHandle: handle, operationId },
        ) as Promise<EccRuntimeOperation>
      const digest = 'sha256:' + 'a'.repeat(64)
      const request: EccCandidateRerunRequest = {
        candidateId: 'candidate-electron-placement',
        idempotencyKey: randomUUID(),
        workspaceHandle: handle,
        expectedWorkspaceRevision: opened.workspaceRevision!,
        targetStep: 'placement',
        endStep: 'harden',
        executionScope: 'full_flow',
        contextSha256: digest,
        parameterCardSha256: digest,
        seed: 17,
        patch: [{ knob_id: 'place.target_density', value: 0.45 }],
      }
      await expect(
        run({ ...request, expectedWorkspaceRevision: opened.workspaceRevision! + 1 }),
      ).rejects.toThrow(/revision/i)

      const failedStart = await run({
        ...request,
        candidateId: 'candidate-electron-invalid-knob',
        idempotencyKey: randomUUID(),
        patch: [{ knob_id: 'place.unknown_knob', value: 0.45 }],
      })
      const failed = await wait(failedStart.operationId)
      expect(failed).toMatchObject({
        state: 'failed',
        error: { message: expect.stringMatching(/knob/i) },
      })

      const started = await run(request)
      const terminal = await wait(started.operationId)
      expect(terminal).toMatchObject({
        state: 'succeeded',
        result: {
          candidateRootRef: '.agent/candidates/candidate-electron-placement',
          candidateManifestSha256: expect.stringMatching(/^sha256:/),
          parameterApplicationReceipt: {
            requested: { knob_id: 'place.target_density', value: 0.45 },
          },
        },
      })
      const evidence = terminal.result!
      const candidateManifest = await readFile(
        join(workspace, String(evidence.candidateManifestRef)),
      )
      expect(evidence.candidateManifestSha256).toBe(
        'sha256:' + createHash('sha256').update(candidateManifest).digest('hex'),
      )
      expect(await run(request)).toMatchObject({
        operationId: started.operationId,
        deduplicated: true,
        state: 'succeeded',
      })
      expect(await readFile(flow, 'utf8')).toBe(initial)
    } finally {
      await launched.close()
    }
  },
  20 * 60_000,
)
