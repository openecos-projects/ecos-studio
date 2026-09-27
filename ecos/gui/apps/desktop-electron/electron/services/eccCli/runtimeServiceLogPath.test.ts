import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveOperationLogPath } from './runtimeService'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

async function writeWorkspace(): Promise<{ workspace: string; runId: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ecc-cli-oplog-'))
  roots.push(root)
  const workspace = join(root, 'ws_1')
  const runId = 'run-7ed8deadbeef'
  await mkdir(join(workspace, 'home', 'run-logs'), { recursive: true })
  await writeFile(join(workspace, 'home', 'run-logs', `${runId}.log`), 'fallback log\n')
  return { workspace, runId }
}

describe('resolveOperationLogPath', () => {
  it('trusts the registry log_path when it stays inside the workspace', async () => {
    const { workspace, runId } = await writeWorkspace()
    await mkdir(join(workspace, 'home', 'run-logs'), { recursive: true })
    await writeFile(join(workspace, 'home', 'custom.log'), 'registry log\n')

    await expect(
      resolveOperationLogPath({
        workspaceDirectory: workspace,
        operationId: runId,
        entry: { run_id: runId, log_path: 'home/custom.log' },
      }),
    ).resolves.toBe(join(workspace, 'home', 'custom.log'))
  })

  it('falls back to the run-id log when the registry entry belongs to another run', async () => {
    const { workspace, runId } = await writeWorkspace()

    await expect(
      resolveOperationLogPath({
        workspaceDirectory: workspace,
        operationId: runId,
        entry: { run_id: 'run-someoneelse', log_path: 'home/custom.log' },
      }),
    ).resolves.toBe(join(workspace, 'home', 'run-logs', `${runId}.log`))
  })

  it.each([
    ['parent traversal', (_workspace: string) => join('..', 'outside.log')],
    ['absolute path', (workspace: string) => join(workspace, '..', 'outside.log')],
    ['nested traversal', () => join('home', '..', '..', 'outside.log')],
  ])('falls back when log_path uses %s', async (_case, logPath) => {
    const { workspace, runId } = await writeWorkspace()

    await expect(
      resolveOperationLogPath({
        workspaceDirectory: workspace,
        operationId: runId,
        entry: { run_id: runId, log_path: logPath(workspace) },
      }),
    ).resolves.toBe(join(workspace, 'home', 'run-logs', `${runId}.log`))
  })

  it('falls back when log_path itself is a symlink', async () => {
    const { workspace, runId } = await writeWorkspace()
    const outside = join(workspace, '..', 'outside.log')
    await writeFile(outside, 'outside\n')
    await symlink(outside, join(workspace, 'home', 'linked.log'))

    await expect(
      resolveOperationLogPath({
        workspaceDirectory: workspace,
        operationId: runId,
        entry: { run_id: runId, log_path: 'home/linked.log' },
      }),
    ).resolves.toBe(join(workspace, 'home', 'run-logs', `${runId}.log`))
  })

  it('falls back when a log_path ancestor directory is a symlink outside the workspace', async () => {
    const { workspace, runId } = await writeWorkspace()
    const outsideDir = join(workspace, '..', 'outside-dir')
    await mkdir(outsideDir)
    await writeFile(join(outsideDir, 'run.log'), 'outside\n')
    await symlink(outsideDir, join(workspace, 'home', 'linked-dir'))

    await expect(
      resolveOperationLogPath({
        workspaceDirectory: workspace,
        operationId: runId,
        entry: { run_id: runId, log_path: 'home/linked-dir/run.log' },
      }),
    ).resolves.toBe(join(workspace, 'home', 'run-logs', `${runId}.log`))
  })

  it('rejects symlinks even when they stay inside the workspace', async () => {
    const { workspace, runId } = await writeWorkspace()
    await writeFile(join(workspace, 'home', 'real.log'), 'inside\n')
    await symlink(
      await realpath(join(workspace, 'home', 'real.log')),
      join(workspace, 'home', 'linked-inside.log'),
    )

    await expect(
      resolveOperationLogPath({
        workspaceDirectory: workspace,
        operationId: runId,
        entry: { run_id: runId, log_path: 'home/linked-inside.log' },
      }),
    ).resolves.toBe(join(workspace, 'home', 'run-logs', `${runId}.log`))
  })

  it('resolves the fallback against the real workspace directory', async () => {
    const { workspace, runId } = await writeWorkspace()
    const resolved = await realpath(workspace)

    await expect(
      resolveOperationLogPath({
        workspaceDirectory: workspace,
        operationId: runId,
        entry: null,
      }),
    ).resolves.toBe(resolve(resolved, 'home', 'run-logs', `${runId}.log`))
  })
})
