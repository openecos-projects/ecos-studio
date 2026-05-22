import { EventEmitter } from 'node:events'
import type { spawn as spawnChild } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopCliCommandRequest } from '@ecos-studio/shared'
import { EccCliAdapter } from './eccCliAdapter'
import { electronLogger } from './logger'

interface SpawnCall {
  args: string[]
  command: string
  options: {
    env?: NodeJS.ProcessEnv
  }
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
  const spawn = vi.fn((command: string, args: string[], options: SpawnCall['options']) => {
    const child = new FakeChild()
    calls.push({ args, command, options })
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

describe('EccCliAdapter', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  function createTempDir(prefix = 'ecos-ecc-adapter-'): string {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    tempDirs.push(directory)
    return directory
  }

  it('maps create_workspace to ecc workspace create with an input JSON file and records active workspace', async () => {
    const tempDir = createTempDir()
    const harness = createSpawnHarness()
    const adapter = new EccCliAdapter({
      spawn: harness.spawn,
      tempDir,
    })
    const createPromise = adapter.execute(request('create_workspace', {
      directory: '/work/demo',
      pdk: 'ics55',
      parameters: { Design: 'demo' },
      rtl_list: ['/rtl/top.v'],
    }), { emit: vi.fn() })

    expect(harness.calls[0]?.command).toBe('ecc')
    expect(harness.calls[0]?.args).toEqual([
      'workspace',
      'create',
      '--input-json',
      expect.any(String),
      '--json',
    ])

    const inputJsonPath = harness.calls[0].args[3]
    expect(JSON.parse(readFileSync(inputJsonPath, 'utf8'))).toEqual({
      directory: '/work/demo',
      pdk: 'ics55',
      parameters: { Design: 'demo' },
      rtl_list: ['/rtl/top.v'],
    })

    complete(harness.children[0], {
      cmd: 'create_workspace',
      data: { directory: '/work/demo' },
      message: ['created'],
      response: 'success',
    })

    await expect(createPromise).resolves.toMatchObject({
      cmd: 'create_workspace',
      data: { directory: '/work/demo' },
      ok: true,
      response: 'success',
    })

    const stepPromise = adapter.execute(request('run_step', {
      rerun: true,
      step: 'Synthesis',
    }), { emit: vi.fn() })

    expect(harness.calls[1]?.args).toEqual([
      'workspace',
      'run-step',
      '--directory',
      '/work/demo',
      '--step',
      'Synthesis',
      '--json',
      '--rerun',
    ])

    complete(harness.children[1], {
      cmd: 'run_step',
      data: { state: 'Success', step: 'Synthesis' },
      message: ['ran'],
      response: 'success',
    })

    await expect(stepPromise).resolves.toMatchObject({ ok: true })
  })

  it('logs the resolved ECC CLI path and spawn argv for diagnostics', async () => {
    const tempDir = createTempDir()
    const binDir = join(tempDir, 'bin')
    const eccBin = join(binDir, 'ecc')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(eccBin, '#!/usr/bin/env bash\n')
    chmodSync(eccBin, 0o755)

    const loggerDebug = vi.spyOn(electronLogger, 'debug').mockImplementation(() => undefined)
    const harness = createSpawnHarness()
    const adapter = new EccCliAdapter({
      env: { PATH: `${binDir}:/usr/bin` },
      spawn: harness.spawn,
    })

    const loadPromise = adapter.execute(request('load_workspace', {
      directory: '/work/demo',
    }), { emit: vi.fn() })

    complete(harness.children[0], {
      cmd: 'load_workspace',
      data: { directory: '/work/demo' },
      message: ['loaded'],
      response: 'success',
    })
    await loadPromise

    expect(loggerDebug).toHaveBeenCalledWith(
      '[ECC CLI] spawn command=%s resolved=%s args=%s pathHead=%s',
      'ecc',
      eccBin,
      'workspace load --directory /work/demo --json',
      `${binDir}:/usr/bin`,
    )
    expect(loggerDebug).toHaveBeenCalledWith(
      '[ECC CLI] completed cmd=%s response=%s elapsed=%dms',
      'load_workspace',
      'success',
      expect.any(Number),
    )
  })

  it('maps workspace commands to CLI argv and normalizes CLI command aliases', async () => {
    const harness = createSpawnHarness()
    const adapter = new EccCliAdapter({ spawn: harness.spawn })

    const loadPromise = adapter.execute(request('load_workspace', {
      directory: '/work/loaded',
    }), { emit: vi.fn() })
    expect(harness.calls[0]?.args).toEqual([
      'workspace',
      'load',
      '--directory',
      '/work/loaded',
      '--json',
    ])
    complete(harness.children[0], {
      cmd: 'load_workspace',
      data: { directory: '/work/loaded' },
      message: ['loaded'],
      response: 'success',
    })
    await expect(loadPromise).resolves.toMatchObject({ ok: true })

    const flowPromise = adapter.execute(request('rtl2gds', { rerun: true }), { emit: vi.fn() })
    expect(harness.calls[1]?.args).toEqual([
      'workspace',
      'run-flow',
      '--directory',
      '/work/loaded',
      '--json',
      '--rerun',
    ])
    complete(harness.children[1], {
      cmd: 'run_flow',
      data: { rerun: true },
      message: ['flow complete'],
      response: 'success',
    })
    await expect(flowPromise).resolves.toMatchObject({
      cmd: 'rtl2gds',
      ok: true,
      response: 'success',
    })

    const infoPromise = adapter.execute(request('get_info', {
      id: 'layout',
      step: 'route',
    }), { emit: vi.fn() })
    expect(harness.calls[2]?.args).toEqual([
      'workspace',
      'get-info',
      '--directory',
      '/work/loaded',
      '--step',
      'route',
      '--id',
      'layout',
      '--json',
    ])
    complete(harness.children[2], {
      cmd: 'get_info',
      data: { id: 'layout', info: {}, step: 'route' },
      message: ['info'],
      response: 'warning',
    })
    await expect(infoPromise).resolves.toMatchObject({
      cmd: 'get_info',
      ok: true,
      response: 'warning',
    })

    const homePromise = adapter.execute(request('home_page'), { emit: vi.fn() })
    expect(harness.calls[3]?.args).toEqual([
      'workspace',
      'get-home',
      '--directory',
      '/work/loaded',
      '--json',
    ])
    complete(harness.children[3], {
      cmd: 'get_home',
      data: { path: '/work/loaded/home/home.json' },
      message: ['home'],
      response: 'success',
    })
    await expect(homePromise).resolves.toMatchObject({
      cmd: 'home_page',
      ok: true,
    })
  })

  it('implements set_pdk_root locally and injects the env into later CLI children', async () => {
    const harness = createSpawnHarness()
    const pdkRoot = createTempDir('ecos-pdk-root-')
    const adapter = new EccCliAdapter({
      env: { PATH: '/usr/bin' },
      spawn: harness.spawn,
    })

    await expect(adapter.execute(request('set_pdk_root', {
      pdk: 'ics55',
      pdk_root: pdkRoot,
    }), { emit: vi.fn() })).resolves.toEqual({
      cmd: 'set_pdk_root',
      data: {
        env_key: 'CHIPCOMPILER_ICS55_PDK_ROOT',
        pdk: 'ics55',
        pdk_root: pdkRoot,
      },
      message: [`set pdk root success: ics55 -> ${pdkRoot}`],
      ok: true,
      response: 'success',
    })

    const runPromise = adapter.execute(request('run_step', {
      directory: '/work/demo',
      step: 'Synthesis',
    }), { emit: vi.fn() })

    expect(harness.calls[0]?.options.env).toMatchObject({
      CHIPCOMPILER_ICS55_PDK_ROOT: pdkRoot,
      PATH: '/usr/bin',
    })

    complete(harness.children[0], {
      cmd: 'run_step',
      data: { state: 'Success', step: 'Synthesis' },
      message: [],
      response: 'success',
    })
    await runPromise
  })

  it('rejects missing or invalid set_pdk_root fields without spawning ECC', async () => {
    const harness = createSpawnHarness()
    const adapter = new EccCliAdapter({ spawn: harness.spawn })

    await expect(adapter.execute(request('set_pdk_root', {
      pdk_root: '/tmp/pdk',
    }), { emit: vi.fn() })).resolves.toMatchObject({
      cmd: 'set_pdk_root',
      ok: false,
      response: 'failed',
    })

    await expect(adapter.execute(request('set_pdk_root', {
      pdk: 'ics55',
      pdk_root: '/path/that/does/not/exist',
    }), { emit: vi.fn() })).resolves.toMatchObject({
      ok: false,
      response: 'failed',
    })
    expect(harness.spawn).not.toHaveBeenCalled()
  })

  it('forwards stdout and stderr events while using JSON stdout as the final result', async () => {
    const harness = createSpawnHarness()
    const emit = vi.fn()
    const adapter = new EccCliAdapter({ spawn: harness.spawn })
    const promise = adapter.execute(request('run_step', {
      directory: '/work/demo',
      step: 'Synthesis',
    }), { emit })

    harness.children[0].stdout.emit('data', 'preparing tools\n')
    harness.children[0].stderr.emit('data', 'warning text\n')
    complete(harness.children[0], {
      cmd: 'run_step',
      data: { state: 'Success', step: 'Synthesis' },
      message: ['done'],
      response: 'success',
    })

    await expect(promise).resolves.toMatchObject({ ok: true })
    expect(emit).toHaveBeenCalledWith({
      stream: 'stdout',
      text: 'preparing tools\n',
      type: 'stdout',
    })
    expect(emit).toHaveBeenCalledWith({
      stream: 'stderr',
      text: 'warning text\n',
      type: 'stderr',
    })
  })

  it('preserves structured data from CLI lifecycle event records', async () => {
    const harness = createSpawnHarness()
    const emit = vi.fn()
    const adapter = new EccCliAdapter({ spawn: harness.spawn })
    const promise = adapter.execute(request('run_step', {
      directory: '/work/demo',
      step: 'Synthesis',
    }), { emit })

    harness.children[0].stdout.emit('data', `${JSON.stringify({
      type: 'event',
      phase: 'completed',
      cmd: 'run_step',
      data: {
        step: 'Synthesis',
        info: {
          subflow_path: '/work/demo/Synthesis/subflow.json',
        },
      },
      message: ['subflow changed'],
    })}\n`)
    complete(harness.children[0], {
      cmd: 'run_step',
      data: { state: 'Success', step: 'Synthesis' },
      message: ['done'],
      response: 'success',
    })

    await expect(promise).resolves.toMatchObject({ ok: true })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        cmd: 'run_step',
        data: {
          step: 'Synthesis',
          info: {
            subflow_path: '/work/demo/Synthesis/subflow.json',
          },
        },
        message: ['subflow changed'],
        response: 'success',
      }),
      stream: 'system',
      type: 'completed',
    }))
  })

  it('normalizes JSONL result records emitted by the CLI', async () => {
    const harness = createSpawnHarness()
    const adapter = new EccCliAdapter({ spawn: harness.spawn })
    const promise = adapter.execute(request('run_step', {
      directory: '/work/demo',
      step: 'Synthesis',
    }), { emit: vi.fn() })

    complete(harness.children[0], {
      cmd: 'run_step',
      data: { state: 'Success', step: 'Synthesis' },
      jobId: 'cli-job-1',
      message: ['done'],
      ok: true,
      response: 'success',
      type: 'result',
    })

    await expect(promise).resolves.toMatchObject({
      cmd: 'run_step',
      data: { state: 'Success', step: 'Synthesis' },
      message: ['done'],
      ok: true,
      response: 'success',
    })
  })

  it('returns structured errors for nonzero exits, invalid JSON, and missing directories', async () => {
    const harness = createSpawnHarness()
    const adapter = new EccCliAdapter({ spawn: harness.spawn })

    await expect(adapter.execute(request('run_step', {
      step: 'Synthesis',
    }), { emit: vi.fn() })).resolves.toMatchObject({
      cmd: 'run_step',
      message: ['missing required field: directory'],
      ok: false,
      response: 'failed',
    })
    expect(harness.spawn).not.toHaveBeenCalled()

    const nonzero = adapter.execute(request('run_step', {
      directory: '/work/demo',
      step: 'Synthesis',
    }), { emit: vi.fn() })
    harness.children[0].stderr.emit('data', 'tool failed\n')
    harness.children[0].emit('close', 1, null)
    await expect(nonzero).resolves.toMatchObject({
      ok: false,
      response: 'error',
    })

    const invalid = adapter.execute(request('home_page', {
      directory: '/work/demo',
    }), { emit: vi.fn() })
    harness.children[1].stdout.emit('data', '{"not valid"\n')
    harness.children[1].emit('close', 0, null)
    await expect(invalid).resolves.toMatchObject({
      ok: false,
      response: 'error',
    })
    await expect(invalid).resolves.toHaveProperty(
      'message.0',
      expect.stringContaining('Invalid JSON'),
    )
  })

  it('rejects file paths for set_pdk_root', async () => {
    const harness = createSpawnHarness()
    const directory = createTempDir()
    const filePath = join(directory, 'not-a-directory')
    mkdirSync(directory, { recursive: true })
    const adapter = new EccCliAdapter({ spawn: harness.spawn })
    rmSync(filePath, { force: true })

    await expect(adapter.execute(request('set_pdk_root', {
      pdk: 'ics55',
      pdk_root: filePath,
    }), { emit: vi.fn() })).resolves.toMatchObject({
      ok: false,
      response: 'failed',
    })
  })
})
