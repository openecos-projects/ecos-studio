import type { EccRuntimeEvent } from '@ecos-studio/shared'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { reconcileQuickStartRunReceipt } from './quickStartRunReceipt'

async function withWorkspace<T>(run: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = await mkdtemp(join(tmpdir(), 'ecos-quick-start-receipt-'))
  try {
    return await run(workspace)
  } finally {
    await rm(workspace, { force: true, recursive: true })
  }
}

async function writeReceipt(workspace: string, operationId = 'op-1') {
  await writeFile(
    join(workspace, 'quick_start_run.json'),
    `${JSON.stringify(
      {
        flow: { operation_id: operationId, plan: { end_step: 'Harden' } },
        keep: 'me',
        snapshot: { workspace: { id: 'ws_0001' } },
        status: 'flow_running',
      },
      null,
      2,
    )}\n`,
  )
}

async function readReceipt(workspace: string) {
  return JSON.parse(await readFile(join(workspace, 'quick_start_run.json'), 'utf8'))
}

describe('reconcileQuickStartRunReceipt', () => {
  it('marks a matching protocol completion as flow_completed', async () => {
    await withWorkspace(async (workspace) => {
      await writeReceipt(workspace)

      const changed = await reconcileQuickStartRunReceipt({
        event: {
          eventId: 'evt-1',
          kind: 'flow',
          operationId: 'op-1',
          origin: 'gui',
          payload: {},
          sequence: 1,
          timestamp: 1700000000,
          type: 'operation.completed',
          workspaceId: 'ws_0001',
        },
        type: 'runtime.protocol',
        workspaceDirectory: workspace,
      })

      await expect(readReceipt(workspace)).resolves.toMatchObject({
        completed_at: '2023-11-14T22:13:20.000Z',
        flow: { operation_id: 'op-1', plan: { end_step: 'Harden' } },
        keep: 'me',
        status: 'flow_completed',
      })
      expect(changed).toBe(true)
    })
  })

  it('marks a matching protocol failure as flow_failed with the ECC error message', async () => {
    await withWorkspace(async (workspace) => {
      await writeReceipt(workspace)

      const changed = await reconcileQuickStartRunReceipt({
        event: {
          eventId: 'evt-2',
          kind: 'flow',
          operationId: 'op-1',
          origin: 'gui',
          payload: { error: { message: 'Sizer failed' } },
          sequence: 2,
          timestamp: 1700000001,
          type: 'operation.failed',
          workspaceId: 'ws_0001',
        },
        type: 'runtime.protocol',
        workspaceDirectory: workspace,
      })

      await expect(readReceipt(workspace)).resolves.toMatchObject({
        error: 'Sizer failed',
        failed_at: '2023-11-14T22:13:21.000Z',
        status: 'flow_failed',
      })
      expect(changed).toBe(true)
    })
  })

  it('marks a matching legacy direct completion as flow_completed', async () => {
    await withWorkspace(async (workspace) => {
      await writeReceipt(workspace)

      const event: EccRuntimeEvent = {
        executionScope: 'full_flow',
        method: 'flow.run',
        operationId: 'op-1',
        type: 'operation.completed',
        workspaceDirectory: workspace,
      }

      await expect(
        reconcileQuickStartRunReceipt(event, { now: () => new Date(0) }),
      ).resolves.toBe(true)
      await expect(readReceipt(workspace)).resolves.toMatchObject({
        completed_at: '1970-01-01T00:00:00.000Z',
        status: 'flow_completed',
      })
    })
  })

  it('leaves mismatched or non-running receipts unchanged', async () => {
    await withWorkspace(async (workspace) => {
      await writeReceipt(workspace, 'op-other')
      const before = await readFile(join(workspace, 'quick_start_run.json'), 'utf8')

      const changed = await reconcileQuickStartRunReceipt({
        event: {
          eventId: 'evt-3',
          kind: 'flow',
          operationId: 'op-1',
          origin: 'gui',
          payload: {},
          sequence: 3,
          timestamp: 1700000002,
          type: 'operation.completed',
          workspaceId: 'ws_0001',
        },
        type: 'runtime.protocol',
        workspaceDirectory: workspace,
      })

      await expect(
        readFile(join(workspace, 'quick_start_run.json'), 'utf8'),
      ).resolves.toBe(before)
      expect(changed).toBe(false)
    })
  })

  it('ignores missing or invalid receipts without throwing', async () => {
    await withWorkspace(async (workspace) => {
      await expect(
        reconcileQuickStartRunReceipt({
          method: 'flow.run',
          operationId: 'op-1',
          type: 'operation.cancelled',
          workspaceDirectory: workspace,
        }),
      ).resolves.toBe(false)

      await writeFile(join(workspace, 'quick_start_run.json'), '{bad json')
      await expect(
        reconcileQuickStartRunReceipt({
          method: 'flow.run',
          operationId: 'op-1',
          type: 'operation.cancelled',
          workspaceDirectory: workspace,
        }),
      ).resolves.toBe(false)
    })
  })
})
