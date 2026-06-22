import { EventEmitter } from 'node:events'
import type { spawn as spawnChild } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopCliCommandRequest } from '@ecos-studio/shared'
import { FrontendCliAdapter } from './frontendCliAdapter'

interface SpawnCall {
  args: string[]
  command: string
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly kill = vi.fn()
}

function request(
  cmd: DesktopCliCommandRequest['cmd'],
  data: Record<string, unknown> = {},
): DesktopCliCommandRequest {
  return {
    cmd,
    data,
    source: 'test',
  }
}

function createSpawnHarness() {
  const children: FakeChild[] = []
  const calls: SpawnCall[] = []
  const spawn = vi.fn((command: string, args: string[]) => {
    const child = new FakeChild()
    calls.push({ args, command })
    children.push(child)
    return child as never
  })

  return {
    calls,
    children,
    spawn: spawn as unknown as typeof spawnChild,
  }
}

function complete(
  child: FakeChild,
  payload: unknown,
  exitCode = 0,
): void {
  child.stdout.emit('data', `${JSON.stringify(payload)}\n`)
  child.emit('close', exitCode, null)
}

function inputJsonPath(args: string[]): string {
  const index = args.indexOf('--input-json')
  if (index < 0 || !args[index + 1]) {
    throw new Error(`Missing --input-json in argv: ${args.join(' ')}`)
  }
  return args[index + 1]
}

describe('FrontendCliAdapter', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  function createTempDir(prefix = 'ecos-fe-adapter-'): string {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    tempDirs.push(directory)
    return directory
  }

  it('lets the frontend CLI resolve catalog SoC runtime defaults', async () => {
    const tempDir = createTempDir()
    const harness = createSpawnHarness()
    const adapter = new FrontendCliAdapter({
      command: '/usr/bin/python3',
      frontendRoot: '/repo/ecc-fe',
      spawn: harness.spawn,
      tempDir,
    })

    const createPromise = adapter.execute(request('create_workspace', {
      core_id: 'serv',
      directory: '/work/test06221',
      parameters: {
        Design: 'test06221',
        soc_harness_id: 'litex-vexriscv-soc',
        soc_variant: 'litex-vexriscv',
      },
      soc_harness_id: 'litex-vexriscv-soc',
      soc_variant: 'litex-vexriscv',
      test_suite_id: 'cpu-tests',
      toolchain_id: 'riscv32-unknown-elf',
    }), { emit: vi.fn() })

    const input = JSON.parse(readFileSync(inputJsonPath(harness.calls[0].args), 'utf8'))
    expect(input.soc_harness_id).toBe('litex-vexriscv-soc')
    expect(input.soc_variant).toBe('litex-vexriscv')
    expect(input.soc_filelist).toBe('')
    expect(input.sim_soc_root).toBe('')
    expect(input.testbench).toBe('')
    expect(input.sim_cpp_sources).toEqual([])
    expect(input.sim_cflags).toEqual([])

    complete(harness.children[0], {
      cmd: 'create_workspace',
      data: { directory: '/work/test06221' },
      message: ['created'],
      response: 'success',
    })

    await expect(createPromise).resolves.toMatchObject({
      cmd: 'create_workspace',
      ok: true,
      response: 'success',
    })
  })
})
