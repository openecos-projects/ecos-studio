import { EventEmitter } from 'node:events'
import type { spawn as spawnChild } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopCliCommandRequest } from '@ecos-studio/shared'
import { FrontendCliAdapter } from './frontendCliAdapter'

interface SpawnCall {
  args: string[]
  command: string
}

interface SpawnOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
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
  const options: SpawnOptions[] = []
  const spawn = vi.fn((command: string, args: string[], spawnOptions?: SpawnOptions) => {
    const child = new FakeChild()
    calls.push({ args, command })
    options.push(spawnOptions ?? {})
    children.push(child)
    return child as never
  })

  return {
    calls,
    children,
    options,
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

  function createFrontendCliEnv(tempDir: string): NodeJS.ProcessEnv {
    const binDir = join(tempDir, 'bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, process.platform === 'win32' ? 'ecc-fe.cmd' : 'ecc-fe'), '')
    return { PATH: binDir }
  }

  it('lets the frontend CLI resolve catalog SoC runtime defaults', async () => {
    const tempDir = createTempDir()
    const harness = createSpawnHarness()
    const adapter = new FrontendCliAdapter({
      env: createFrontendCliEnv(tempDir),
      frontendRoot: '/repo/ecc-fe',
      spawn: harness.spawn,
      tempDir,
    })

    const createPromise = adapter.execute(request('create_workspace', {
      core_id: 'serv',
      directory: '/work/test06221',
      parameters: {
        Design: 'test06221',
        soc_harness_id: 'ysyx-am-soc',
        soc_variant: 'soc1',
      },
      soc_harness_id: 'ysyx-am-soc',
      soc_variant: 'soc1',
      test_suite_id: 'cpu-tests',
      toolchain_id: 'riscv32-unknown-elf',
    }), { emit: vi.fn() })

    const input = JSON.parse(readFileSync(inputJsonPath(harness.calls[0].args), 'utf8'))
    expect(harness.calls[0].command).toBe('ecc-fe')
    expect(input.soc_harness_id).toBe('ysyx-am-soc')
    expect(input.soc_variant).toBe('soc1')
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

  it('passes CoreMark compile options to the frontend CLI run-step command', async () => {
    const tempDir = createTempDir()
    const harness = createSpawnHarness()
    const adapter = new FrontendCliAdapter({
      env: createFrontendCliEnv(tempDir),
      frontendRoot: '/repo/ecc-fe',
      spawn: harness.spawn,
    })

    const runPromise = adapter.execute(request('run_step', {
      directory: '/work/test0623a',
      rerun: true,
      sim_compile_extra_cflags: ['-funroll-loops', '-DMEM_METHOD=MEM_STACK'],
      sim_compile_mabi: 'ilp32',
      sim_compile_march: 'rv32im_zicsr',
      sim_compile_opt_level: '-O3',
      sim_compile_preset: 'speed',
      sim_coremark_has_float: 'true',
      sim_coremark_iterations: '32',
      sim_coremark_total_data_size: '2000',
      sim_test_suite: 'coremark',
      step: 'sim',
    }), { emit: vi.fn() })

    expect(harness.calls[0].command).toBe('ecc-fe')
    expect(harness.calls[0].args).toEqual([
      'workspace',
      'run-step',
      '--directory',
      '/work/test0623a',
      '--step',
      'sim',
      '--json',
      '--rerun',
      '--sim-test-suite',
      'coremark',
      '--sim-compile-preset=speed',
      '--sim-compile-opt-level=-O3',
      '--sim-compile-march=rv32im_zicsr',
      '--sim-compile-mabi=ilp32',
      '--sim-compile-extra-cflag=-funroll-loops',
      '--sim-compile-extra-cflag=-DMEM_METHOD=MEM_STACK',
      '--sim-coremark-iterations=32',
      '--sim-coremark-total-data-size=2000',
      '--sim-coremark-has-float=true',
    ])

    complete(harness.children[0], {
      cmd: 'run_step',
      data: { directory: '/work/test0623a', state: 'Success', step: 'sim' },
      message: ['sim completed'],
      response: 'success',
    })

    await expect(runPromise).resolves.toMatchObject({
      cmd: 'run_step',
      ok: true,
      response: 'success',
    })
  })

  it('keeps explicit python command overrides compatible with module mode', async () => {
    const harness = createSpawnHarness()
    const adapter = new FrontendCliAdapter({
      command: '/usr/bin/python3',
      frontendRoot: '/repo/ecc-fe',
      spawn: harness.spawn,
    })

    const listPromise = adapter.execute(request('catalog_list'), { emit: vi.fn() })

    expect(harness.calls[0]).toEqual({
      args: [
        '-m',
        'fecompiler.cli.main',
        'workspace',
        'catalog-list',
        '--json',
      ],
      command: '/usr/bin/python3',
    })

    complete(harness.children[0], {
      cmd: 'catalog_list',
      data: {},
      message: ['catalog loaded'],
      response: 'success',
    })

    await expect(listPromise).resolves.toMatchObject({
      cmd: 'catalog_list',
      ok: true,
      response: 'success',
    })
  })

  it('honors ECOS_FE_CLI command override from the runtime environment', async () => {
    const tempDir = createTempDir()
    const customCli = join(tempDir, 'tools', 'ecc-fe')
    mkdirSync(join(tempDir, 'tools'), { recursive: true })
    writeFileSync(customCli, '')
    const harness = createSpawnHarness()
    const adapter = new FrontendCliAdapter({
      env: {
        ECOS_FE_CLI: customCli,
        PATH: '',
      },
      frontendRoot: '/repo/ecc-fe',
      spawn: harness.spawn,
    })

    const listPromise = adapter.execute(request('catalog_list'), { emit: vi.fn() })

    expect(harness.calls[0]).toEqual({
      args: ['workspace', 'catalog-list', '--json'],
      command: customCli,
    })

    complete(harness.children[0], {
      cmd: 'catalog_list',
      data: {},
      message: ['catalog loaded'],
      response: 'success',
    })

    await expect(listPromise).resolves.toMatchObject({
      cmd: 'catalog_list',
      ok: true,
      response: 'success',
    })
  })

  it('treats ECOS_FE_CLI python overrides as module mode', async () => {
    const harness = createSpawnHarness()
    const adapter = new FrontendCliAdapter({
      env: {
        ECOS_FE_CLI: '/usr/bin/python3',
        PATH: '',
      },
      frontendRoot: '/repo/ecc-fe',
      spawn: harness.spawn,
    })

    const listPromise = adapter.execute(request('catalog_list'), { emit: vi.fn() })

    expect(harness.calls[0]).toEqual({
      args: [
        '-m',
        'fecompiler.cli.main',
        'workspace',
        'catalog-list',
        '--json',
      ],
      command: '/usr/bin/python3',
    })

    complete(harness.children[0], {
      cmd: 'catalog_list',
      data: {},
      message: ['catalog loaded'],
      response: 'success',
    })

    await expect(listPromise).resolves.toMatchObject({
      cmd: 'catalog_list',
      ok: true,
      response: 'success',
    })
  })

  it('falls back to python module mode when the ecc-fe command is not on PATH', async () => {
    const tempDir = createTempDir()
    const frontendRoot = join(tempDir, 'ecc-fe')
    mkdirSync(join(frontendRoot, 'fecompiler'), { recursive: true })
    const harness = createSpawnHarness()
    const adapter = new FrontendCliAdapter({
      env: {
        PATH: '',
      },
      frontendRoot,
      spawn: harness.spawn,
    })

    const listPromise = adapter.execute(request('catalog_list'), { emit: vi.fn() })

    expect(harness.calls[0].command).toMatch(/python/)
    expect(harness.calls[0].args).toEqual([
      '-m',
      'fecompiler.cli.main',
      'workspace',
      'catalog-list',
      '--json',
    ])

    complete(harness.children[0], {
      cmd: 'catalog_list',
      data: {},
      message: ['catalog loaded'],
      response: 'success',
    })

    await expect(listPromise).resolves.toMatchObject({
      cmd: 'catalog_list',
      ok: true,
      response: 'success',
    })
  })

  it('uses the Resource Manager frontend root without a source-tree override', async () => {
    const tempDir = createTempDir()
    const installedRoot = join(tempDir, 'installed-ecc-fe')
    const installedCli = join(installedRoot, 'bin', 'ecc-fe')
    mkdirSync(join(installedRoot, 'fecompiler'), { recursive: true })
    mkdirSync(join(installedRoot, 'bin'), { recursive: true })
    writeFileSync(installedCli, '')
    const harness = createSpawnHarness()
    const adapter = new FrontendCliAdapter({
      env: { PATH: '' },
      envProvider: async () => ({
        ECOS_FE_CLI: installedCli,
        ECOS_FE_COMPILER_ROOT: installedRoot,
        PATH: '',
      }),
      spawn: harness.spawn,
    })

    const listPromise = adapter.execute(request('catalog_list'), { emit: vi.fn() })

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1))
    expect(harness.calls[0].command).toBe(installedCli)
    expect(harness.options[0].cwd).toBe(installedRoot)
    expect(harness.options[0].env?.ECOS_FE_COMPILER_ROOT).toBe(installedRoot)

    complete(harness.children[0], {
      cmd: 'catalog_list',
      data: {},
      message: ['catalog loaded'],
      response: 'success',
    })
    await expect(listPromise).resolves.toMatchObject({ response: 'success' })
  })

  it('uses the development root CLI ahead of the installed Resource Manager CLI', async () => {
    const tempDir = createTempDir()
    const installedRoot = join(tempDir, 'installed-ecc-fe')
    const developmentRoot = join(tempDir, 'development-ecc-fe')
    const installedCli = join(installedRoot, 'bin', 'ecc-fe')
    const developmentCli = join(developmentRoot, 'bin', 'ecc-fe')
    mkdirSync(join(installedRoot, 'fecompiler'), { recursive: true })
    mkdirSync(join(installedRoot, 'bin'), { recursive: true })
    mkdirSync(join(developmentRoot, 'fecompiler'), { recursive: true })
    mkdirSync(join(developmentRoot, 'bin'), { recursive: true })
    writeFileSync(installedCli, '')
    writeFileSync(developmentCli, '')
    const harness = createSpawnHarness()
    const adapter = new FrontendCliAdapter({
      envProvider: async () => ({
        ECOS_FE_CLI: installedCli,
        ECOS_FE_COMPILER_ROOT: installedRoot,
        PATH: '',
      }),
      frontendRoot: developmentRoot,
      spawn: harness.spawn,
    })

    const listPromise = adapter.execute(request('catalog_list'), { emit: vi.fn() })

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1))
    expect(harness.calls[0].command).toBe(developmentCli)
    expect(harness.options[0].cwd).toBe(developmentRoot)
    expect(harness.options[0].env?.ECOS_FE_COMPILER_ROOT).toBe(developmentRoot)

    complete(harness.children[0], {
      cmd: 'catalog_list',
      data: {},
      message: ['catalog loaded'],
      response: 'success',
    })
    await expect(listPromise).resolves.toMatchObject({ response: 'success' })
  })
})
