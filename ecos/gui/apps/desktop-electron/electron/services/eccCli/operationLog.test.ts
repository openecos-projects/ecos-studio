import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openOperationLog, readOperationLog, readRunFailure } from './operationLog'

describe('ECC run logs', () => {
  let root: string
  let workspace: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ecc-run-log-'))
    workspace = join(root, 'workspace')
    await mkdir(workspace)
  })
  afterEach(async () => {
    await rm(root, { force: true, recursive: true })
  })

  it('reads only the bounded tail from the canonical run log', async () => {
    const log = await openOperationLog(workspace, 'run-1', true)
    await log.writeFile('x'.repeat(64 * 1024) + 'tail')
    await log.close()
    const { content, truncated } = await readOperationLog(workspace, 'run-1')
    expect(truncated).toBe(true)
    expect(content).toHaveLength(64 * 1024)
    expect(content.endsWith('tail')).toBe(true)
  })

  it('rejects a symlink in the run log directory', async () => {
    await writeFile(join(root, 'run-1.log'), 'outside workspace')
    await symlink(root, join(workspace, 'log'))
    await expect(readOperationLog(workspace, 'run-1')).rejects.toThrow(
      'The Workspace log directory must not be a symbolic link.',
    )
    await expect(openOperationLog(workspace, 'run-2', true)).rejects.toThrow(
      'The Workspace log directory must not be a symbolic link.',
    )
  })

  it('rejects a symlink in the run log file', async () => {
    const outside = join(root, 'outside.log')
    await writeFile(outside, 'outside workspace')
    await mkdir(join(workspace, 'log'))
    await symlink(outside, join(workspace, 'log', 'run-1.log'))
    await expect(readOperationLog(workspace, 'run-1')).rejects.toMatchObject({
      code: 'ELOOP',
    })
    await expect(openOperationLog(workspace, 'run-1', true)).rejects.toMatchObject({
      code: 'ELOOP',
    })
  })

  it('extracts the CLI error from a mixed tool log', () => {
    const output =
      'tool output\nkind=error error=step_input_missing reason="inputs missing"\n'
    expect(readRunFailure(output)).toEqual({
      code: 'step_input_missing',
      message: 'inputs missing',
    })
    expect(
      readRunFailure('tool output\nworkspace_id=default status=failed'),
    ).toBeUndefined()
  })
})
