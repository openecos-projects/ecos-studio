import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ResourceManagerService } from './resourceManagerService'

const tempDirectories: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

async function createFixtureArchive(root: string): Promise<{ path: string; sha256: string; size: number }> {
  const archive = join(root, 'yosys.tar')
  const payload = 'fake archive payload'
  await writeFile(archive, payload, 'utf8')
  return {
    path: archive,
    sha256: 'fixture-sha',
    size: Buffer.byteLength(payload),
  }
}

async function runFixtureCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(command, args, { cwd: options?.cwd }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} failed: ${stderr || error.message}`))
        return
      }
      resolve()
    })
    child.on('error', reject)
  })
}

async function createPdkArchive(
  root: string,
  options: { makefileContent?: string } = {},
): Promise<{ path: string; sha256: string; size: number }> {
  const sourceRoot = join(root, 'pdk-source')
  const sourceDir = join(sourceRoot, 'icsprout55-pdk-1.10.100')
  const archive = join(root, 'ics55.tar')
  await mkdir(join(sourceDir, 'IP'), { recursive: true })
  await mkdir(join(sourceDir, 'prtech'), { recursive: true })
  await writeFile(join(sourceDir, 'README.md'), 'fixture pdk\n', 'utf8')
  if (options.makefileContent) {
    await writeFile(join(sourceDir, 'Makefile'), options.makefileContent, 'utf8')
  }
  await runFixtureCommand('tar', ['-cf', archive, '-C', sourceRoot, 'icsprout55-pdk-1.10.100'])
  const size = Buffer.byteLength(await readFile(archive))
  return {
    path: archive,
    sha256: 'fixture-pdk-sha',
    size,
  }
}

async function createSurferAssetsZip(root: string): Promise<{ path: string; sha256: string; size: number }> {
  const sourceRoot = join(root, 'surfer-source')
  const sourceDir = join(sourceRoot, 'surfer-web-assets')
  const archive = join(root, 'surfer.zip')
  await mkdir(sourceDir, { recursive: true })
  await writeFile(join(sourceDir, 'index.html'), '<!doctype html>\n', 'utf8')
  await writeFile(join(sourceDir, 'integration.js'), 'function register_message_listener() {}\n', 'utf8')
  await writeFile(join(sourceDir, 'surfer.js'), 'export default async function init() {}\n', 'utf8')
  await writeFile(join(sourceDir, 'surfer_bg.wasm'), 'wasm', 'utf8')
  await runFixtureCommand('zip', ['-qr', archive, 'surfer-web-assets'], { cwd: sourceRoot })
  const size = Buffer.byteLength(await readFile(archive))
  return {
    path: archive,
    sha256: 'fixture-surfer-sha',
    size,
  }
}

async function createEccFeArchive(root: string): Promise<{ path: string; sha256: string; size: number }> {
  const sourceRoot = join(root, 'ecc-fe-source')
  const sourceDir = join(sourceRoot, 'ecc-fe-runtime')
  const archive = join(root, 'ecc-fe.tar')
  await mkdir(join(sourceDir, 'bin'), { recursive: true })
  await mkdir(join(sourceDir, 'fecompiler'), { recursive: true })
  await writeFile(join(sourceDir, 'bin', 'ecc-fe'), '#!/bin/sh\n', 'utf8')
  await chmod(join(sourceDir, 'bin', 'ecc-fe'), 0o755)
  await writeFile(join(sourceDir, 'fecompiler', '__init__.py'), '', 'utf8')
  await runFixtureCommand('tar', ['-cf', archive, '-C', sourceRoot, 'ecc-fe-runtime'])
  const size = Buffer.byteLength(await readFile(archive))
  return {
    path: archive,
    sha256: 'fixture-ecc-fe-sha',
    size,
  }
}

async function createEccFeSocArchive(root: string): Promise<{ path: string; sha256: string; size: number }> {
  const sourceRoot = join(root, 'ecc-fe-soc-source')
  const sourceDir = join(sourceRoot, 'ecc-fe-soc-ysyx-am')
  const archive = join(root, 'ecc-fe-soc.tar')
  await mkdir(sourceDir, { recursive: true })
  await writeFile(join(sourceDir, 'ecos_sim_top.v'), 'module ecos_sim_top; endmodule\n', 'utf8')
  await runFixtureCommand('tar', ['-cf', archive, '-C', sourceRoot, 'ecc-fe-soc-ysyx-am'])
  const size = Buffer.byteLength(await readFile(archive))
  return {
    path: archive,
    sha256: 'fixture-ecc-fe-soc-sha',
    size,
  }
}

async function createEccFeCpuRtlArchive(root: string): Promise<{ path: string; sha256: string; size: number }> {
  const sourceRoot = join(root, 'ecc-fe-cpu-rtl-source')
  const sourceDir = join(sourceRoot, 'ecc-fe-cpu-rtl')
  const archive = join(root, 'ecc-fe-cpu-rtl.tar')
  await mkdir(join(sourceDir, 'thirdparty', 'cv32e40p'), { recursive: true })
  await writeFile(join(sourceDir, 'thirdparty', 'cv32e40p', 'README.md'), 'fixture cpu rtl\n', 'utf8')
  await runFixtureCommand('tar', ['-cf', archive, '-C', sourceRoot, 'ecc-fe-cpu-rtl'])
  const size = Buffer.byteLength(await readFile(archive))
  return {
    path: archive,
    sha256: 'fixture-ecc-fe-cpu-rtl-sha',
    size,
  }
}

async function createEccFeExamplesArchive(root: string): Promise<{ path: string; sha256: string; size: number }> {
  const sourceRoot = join(root, 'ecc-fe-examples-source')
  const sourceDir = join(sourceRoot, 'ecc-fe-examples')
  const archive = join(root, 'ecc-fe-examples.tar')
  await mkdir(join(sourceDir, 'examples', 'cl3'), { recursive: true })
  await writeFile(join(sourceDir, 'examples', 'cl3', 'filelist.cpu.f'), 'cl3_verilog/CL3Top.sv\n', 'utf8')
  await runFixtureCommand('tar', ['-cf', archive, '-C', sourceRoot, 'ecc-fe-examples'])
  const size = Buffer.byteLength(await readFile(archive))
  return {
    path: archive,
    sha256: 'fixture-ecc-fe-examples-sha',
    size,
  }
}

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value?: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value?: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

function testRegistryCachePath(cacheDir: string, registryUrl: string): string {
  const key = createHash('sha256').update(registryUrl).digest('hex').slice(0, 12)
  return join(cacheDir, `resource-registry-${key}.json`)
}

describe('ResourceManagerService', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    )
  })

  it('lists registry resources and imported PDKs from the desktop manifest', async () => {
    const root = await createTempDir('ecos-resources-')
    const registryPath = join(root, 'registry.json')
    const pdkPath = join(root, 'pdks', 'ics55')
    await mkdir(pdkPath, { recursive: true })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'yosys',
          display_name: 'Yosys',
          description: 'RTL synthesis',
          category: 'synthesis',
          homepage: 'https://example.com/yosys',
          versions: [
            {
              version: '0.61',
              platforms: {
                'all-platform': {
                  url: 'file:///tmp/yosys.tar',
                  sha256: 'sha',
                  size: 12,
                },
              },
            },
          ],
        },
      ],
      pdks: [
        {
          id: 'ics55',
          display_name: 'ICSPROUT 55nm PDK',
          description: 'Integrated Circuit Systems 55nm PDK',
          category: 'pdk',
          homepage: 'https://example.com/ics55',
          versions: [
            {
              version: '1.01',
              platforms: {
                'all-platform': {
                  url: 'file:///tmp/ics55.tar',
                  sha256: 'pdk-sha',
                  size: 432,
                },
              },
            },
          ],
        },
      ],
    }), 'utf8')

    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
    })
    const imported = await service.importPdkPath(pdkPath)
    await service.activatePdk(imported.id)

    const result = await service.listResources()

    expect(result.diagnostics).toEqual([])
    expect(result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tool:yosys',
        type: 'tool',
        status: 'available',
        available_versions: ['0.61'],
        actions: ['install'],
      }),
      expect.objectContaining({
        id: 'pdk:ics55',
        type: 'pdk',
        status: 'installed',
        active: true,
        path: pdkPath,
        actions: ['validate', 'remove_reference'],
      }),
    ]))
  })

  it('builds a runtime env from active healthy Resource Manager resources', async () => {
    const root = await createTempDir('ecos-resources-')
    const resourcesDir = join(root, 'state', 'resources')
    const toolsDir = join(root, 'data', 'tools')
    const pdksDir = join(root, 'data', 'pdks')
    const packagedBin = join(root, 'packaged', 'binaries')
    const yosysRoot = join(toolsDir, 'yosys', '2026-05-13')
    const slangRoot = join(toolsDir, 'slang', '10.0')
    const verilatorRoot = join(toolsDir, 'verilator', '5.046')
    const eccFeRoot = join(toolsDir, 'ecc-fe', '0.1.0-alpha.0-ecos')
    const eccFeSocRoot = join(toolsDir, 'ecc-fe-soc-ysyx-am', '0.1.0-alpha.0-ecos')
    const eccFeExamplesRoot = join(toolsDir, 'ecc-fe-examples', '0.1.0-alpha.0-ecos')
    const riscvRoot = join(toolsDir, 'riscv-toolchain', 'rv32')
    const surferRoot = join(toolsDir, 'surfer', '0.4.0')
    const duplicateRoot = join(toolsDir, 'duplicate', '1.0')
    const inactiveRoot = join(toolsDir, 'inactive', '1.0')
    const missingRoot = join(toolsDir, 'missing', '1.0')
    const ics55Root = join(pdksDir, 'ics55', '1.10.100')
    await mkdir(join(yosysRoot, 'bin'), { recursive: true })
    await mkdir(join(slangRoot, 'bin'), { recursive: true })
    await mkdir(join(verilatorRoot, 'bin'), { recursive: true })
    await mkdir(join(eccFeRoot, 'bin'), { recursive: true })
    await mkdir(eccFeSocRoot, { recursive: true })
    await mkdir(eccFeExamplesRoot, { recursive: true })
    await mkdir(join(riscvRoot, 'bin'), { recursive: true })
    await mkdir(surferRoot, { recursive: true })
    await mkdir(join(duplicateRoot, 'bin'), { recursive: true })
    await mkdir(join(inactiveRoot, 'bin'), { recursive: true })
    await mkdir(ics55Root, { recursive: true })
    await mkdir(resourcesDir, { recursive: true })
    await writeFile(join(yosysRoot, 'bin', 'yosys'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(yosysRoot, 'bin', 'verilator'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(slangRoot, 'bin', 'slang'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(verilatorRoot, 'bin', 'verilator'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(eccFeRoot, 'bin', 'ecc-fe'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(riscvRoot, 'bin', 'riscv32-unknown-elf-gcc'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(surferRoot, 'index.html'), '<!doctype html>\n', 'utf8')
    await writeFile(join(surferRoot, 'integration.js'), 'function register_message_listener() {}\n', 'utf8')
    await writeFile(join(surferRoot, 'surfer.js'), 'export default async function init() {}\n', 'utf8')
    await writeFile(join(surferRoot, 'surfer_bg.wasm'), 'wasm', 'utf8')
    await writeFile(join(duplicateRoot, 'bin', 'duplicate'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(inactiveRoot, 'bin', 'inactive'), '#!/bin/sh\n', 'utf8')
    await chmod(join(yosysRoot, 'bin', 'yosys'), 0o755)
    await chmod(join(yosysRoot, 'bin', 'verilator'), 0o755)
    await chmod(join(slangRoot, 'bin', 'slang'), 0o755)
    await chmod(join(verilatorRoot, 'bin', 'verilator'), 0o755)
    await chmod(join(eccFeRoot, 'bin', 'ecc-fe'), 0o755)
    await chmod(join(riscvRoot, 'bin', 'riscv32-unknown-elf-gcc'), 0o755)
    await chmod(join(duplicateRoot, 'bin', 'duplicate'), 0o755)
    await chmod(join(inactiveRoot, 'bin', 'inactive'), 0o755)
    await writeFile(join(resourcesDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:yosys': {
          type: 'tool',
          name: 'yosys',
          version: '2026-05-13',
          path: yosysRoot,
          executable: 'bin/yosys',
          detected_executables: ['bin/yosys', 'bin/verilator'],
          active: true,
          managed: true,
        },
        'tool:duplicate': {
          type: 'tool',
          name: 'duplicate',
          version: '1.0',
          path: duplicateRoot,
          executable: 'bin/duplicate',
          active: true,
          managed: true,
        },
        'tool:slang': {
          type: 'tool',
          name: 'slang',
          version: '10.0',
          path: slangRoot,
          executable: 'bin/slang',
          active: true,
          managed: true,
        },
        'tool:verilator': {
          type: 'tool',
          name: 'verilator',
          version: '5.046',
          path: verilatorRoot,
          executable: 'bin/verilator',
          active: true,
          managed: true,
        },
        'tool:ecc-fe': {
          type: 'tool',
          name: 'ecc-fe',
          version: '0.1.0-alpha.0-ecos',
          path: eccFeRoot,
          executable: 'bin/ecc-fe',
          detected_executables: ['bin/ecc-fe'],
          active: true,
          managed: true,
        },
        'tool:ecc-fe-soc-ysyx-am': {
          type: 'tool',
          name: 'ecc-fe-soc-ysyx-am',
          version: '0.1.0-alpha.0-ecos',
          path: eccFeSocRoot,
          executable: '',
          detected_executables: [],
          active: true,
          managed: true,
        },
        'tool:ecc-fe-examples': {
          type: 'tool',
          name: 'ecc-fe-examples',
          version: '0.1.0-alpha.0-ecos',
          path: eccFeExamplesRoot,
          executable: '',
          detected_executables: [],
          active: true,
          managed: true,
        },
        'tool:riscv-toolchain': {
          type: 'tool',
          name: 'riscv-toolchain',
          version: 'rv32',
          path: riscvRoot,
          executable: 'bin/riscv32-unknown-elf-gcc',
          detected_executables: ['bin/riscv32-unknown-elf-gcc'],
          active: true,
          managed: true,
        },
        'tool:surfer': {
          type: 'tool',
          name: 'surfer',
          version: '0.4.0',
          path: surferRoot,
          executable: 'index.html',
          active: true,
          managed: true,
        },
        'tool:inactive': {
          type: 'tool',
          name: 'inactive',
          version: '1.0',
          path: inactiveRoot,
          executable: 'bin/inactive',
          active: false,
          managed: true,
        },
        'tool:missing': {
          type: 'tool',
          name: 'missing',
          version: '1.0',
          path: missingRoot,
          executable: 'bin/missing',
          active: true,
          managed: true,
        },
        'pdk:ics55': {
          type: 'pdk',
          id: 'ics55',
          name: 'ICsprout 55nm',
          pdk_id: 'ics55',
          version: '1.10.100',
          path: ics55Root,
          canonical_path: ics55Root,
          active: true,
          managed: true,
          health: 'ok',
        },
      },
    }), 'utf8')
    const service = new ResourceManagerService({
      resourcesDir,
      toolsDir,
      pdksDir,
    })
    const baseEnv = {
      PATH: [
        packagedBin,
        join(duplicateRoot, 'bin'),
        '/usr/bin',
        join(yosysRoot, 'bin'),
      ].join(':'),
      ECOS_ELECTRON_OSS_CAD_DIR: '/packaged/oss-cad-suite',
      KEEP_ME: 'yes',
    }

    const env = await service.createRuntimeEnv(baseEnv, { platform: 'linux' })

    expect(baseEnv.PATH).toBe([
      packagedBin,
      join(duplicateRoot, 'bin'),
      '/usr/bin',
      join(yosysRoot, 'bin'),
    ].join(':'))
    expect(env).not.toBe(baseEnv)
    expect(env.PATH?.split(':')).toEqual([
      packagedBin,
      join(yosysRoot, 'bin'),
      join(duplicateRoot, 'bin'),
      join(slangRoot, 'bin'),
      join(verilatorRoot, 'bin'),
      join(eccFeRoot, 'bin'),
      join(riscvRoot, 'bin'),
      '/usr/bin',
    ])
    expect(env.CHIPCOMPILER_OSS_CAD_DIR).toBe(yosysRoot)
    expect(env.ECOS_ELECTRON_OSS_CAD_DIR).toBe(yosysRoot)
    expect(env.ECOS_SLANG).toBe(join(slangRoot, 'bin', 'slang'))
    expect(env.ECOS_VERILATOR).toBe(join(verilatorRoot, 'bin', 'verilator'))
    expect(env.VERILATOR_ROOT).toBe(join(verilatorRoot, 'share', 'verilator'))
    expect(env.ECOS_FE_CLI).toBe(join(eccFeRoot, 'bin', 'ecc-fe'))
    expect(env.ECOS_FE_COMPILER_ROOT).toBe(eccFeRoot)
    expect(env.ECOS_FE_RESOURCE_ROOTS).toBe(`${eccFeSocRoot}:${eccFeExamplesRoot}`)
    expect(env.ECOS_FE_SOC_ROOT).toBe(eccFeSocRoot)
    expect(env.RISCV_PREFIX).toBe('riscv32-unknown-elf-')
    expect(env.RISCV).toBe(riscvRoot)
    expect(env.RISCV_TOOLCHAIN).toBe(riscvRoot)
    expect(env.ECOS_SURFER_ASSETS_PATH).toBe(surferRoot)
    expect(env.CHIPCOMPILER_ICS55_PDK_ROOT).toBe(ics55Root)
    expect(env.ICS55_PDK_ROOT).toBe(ics55Root)
    expect(env.KEEP_ME).toBe('yes')
    expect(env.PATH).not.toContain(join(inactiveRoot, 'bin'))
    expect(env.PATH).not.toContain(join(missingRoot, 'bin'))
  })

  it('resolves OSS CAD Suite Yosys and Verilator executables separately', async () => {
    const root = await createTempDir('ecos-resources-')
    const resourcesDir = join(root, 'state', 'resources')
    const toolsDir = join(root, 'data', 'tools')
    const pdksDir = join(root, 'data', 'pdks')
    const ossRoot = join(toolsDir, 'yosys', '2026-05-13')
    await mkdir(join(ossRoot, 'bin'), { recursive: true })
    await mkdir(join(ossRoot, 'share', 'verilator'), { recursive: true })
    await mkdir(resourcesDir, { recursive: true })
    await writeFile(join(ossRoot, 'bin', 'yosys'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(ossRoot, 'bin', 'verilator'), '#!/bin/sh\n', 'utf8')
    await chmod(join(ossRoot, 'bin', 'yosys'), 0o755)
    await chmod(join(ossRoot, 'bin', 'verilator'), 0o755)
    await writeFile(join(resourcesDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:yosys': {
          type: 'tool',
          name: 'yosys',
          version: '2026-05-13',
          path: ossRoot,
          executable: 'bin/yosys',
          detected_executables: ['bin/yosys', 'bin/verilator'],
          active: true,
          managed: true,
        },
      },
    }), 'utf8')
    const service = new ResourceManagerService({
      resourcesDir,
      toolsDir,
      pdksDir,
    })

    const env = await service.createRuntimeEnv({ PATH: '/usr/bin' }, { platform: 'linux' })

    expect(env.CHIPCOMPILER_OSS_CAD_DIR).toBe(ossRoot)
    expect(env.ECOS_ELECTRON_OSS_CAD_DIR).toBe(ossRoot)
    expect(env.ECOS_VERILATOR).toBe(join(ossRoot, 'bin', 'verilator'))
    expect(env.ECOS_VERILATOR).not.toBe(join(ossRoot, 'bin', 'yosys'))
    expect(env.VERILATOR_ROOT).toBe(join(ossRoot, 'share', 'verilator'))
    expect(env.PATH?.split(':')).toEqual([join(ossRoot, 'bin'), '/usr/bin'])
  })

  it('recovers runtime tools when an old manifest points at the wrong executable path', async () => {
    const root = await createTempDir('ecos-resources-')
    const resourcesDir = join(root, 'state', 'resources')
    const toolsDir = join(root, 'data', 'tools')
    const pdksDir = join(root, 'data', 'pdks')
    const slangRoot = join(toolsDir, 'slang', '11.0')
    await mkdir(slangRoot, { recursive: true })
    await mkdir(resourcesDir, { recursive: true })
    await writeFile(join(slangRoot, 'slang'), '#!/bin/sh\n', 'utf8')
    await chmod(join(slangRoot, 'slang'), 0o755)
    await writeFile(join(resourcesDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:slang': {
          type: 'tool',
          name: 'slang',
          version: '11.0',
          path: slangRoot,
          executable: 'bin/slang',
          detected_executables: [],
          active: true,
          managed: true,
        },
      },
    }), 'utf8')
    const service = new ResourceManagerService({
      resourcesDir,
      toolsDir,
      pdksDir,
    })

    const env = await service.createRuntimeEnv({ PATH: '/usr/bin' }, { platform: 'linux' })

    expect(env.ECOS_SLANG).toBe(join(slangRoot, 'slang'))
    expect(env.PATH?.split(':')).toEqual([slangRoot, '/usr/bin'])
  })

  it('returns a copied base env when no Resource Manager manifest exists', async () => {
    const root = await createTempDir('ecos-resources-')
    const service = new ResourceManagerService({
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
    })
    const baseEnv = {
      PATH: '/usr/bin',
      ECOS_ELECTRON_OSS_CAD_DIR: '/packaged/oss-cad-suite',
    }

    const env = await service.createRuntimeEnv(baseEnv, { platform: 'linux' })

    expect(env).toEqual(baseEnv)
    expect(env).not.toBe(baseEnv)
  })

  it('installs a managed tool and emits progress without using the legacy server', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createFixtureArchive(root)
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'yosys',
          display_name: 'Yosys',
          description: 'RTL synthesis',
          category: 'synthesis',
          homepage: '',
          versions: [
            {
              version: '0.61',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const extract = vi.fn(async (_archivePath: string, destination: string) => {
      await mkdir(join(destination, 'bin'), { recursive: true })
      const executable = join(destination, 'bin', 'yosys')
      await writeFile(executable, '#!/bin/sh\n', 'utf8')
      await chmod(executable, 0o755)
    })
    const verifySha256 = vi.fn(async () => true)
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      archiveExtractor: extract,
      sha256Verifier: verifySha256,
    })
    const progress = vi.fn()

    await expect(service.installResource('tool:yosys', '0.61', progress)).resolves.toEqual({
      status: 'started',
      resource_id: 'tool:yosys',
      version: '0.61',
    })

    const installed = await service.getResource('tool:yosys')
    expect(installed).toMatchObject({
      id: 'tool:yosys',
      status: 'installed',
      installed_version: '0.61',
      path: join(root, 'data', 'tools', 'yosys', '0.61'),
      size: archive.size,
      actions: ['uninstall'],
    })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      resource_id: 'tool:yosys',
      phase: 'downloading',
    }))
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      resource_id: 'tool:yosys',
      phase: 'done',
      progress: 1,
    }))
    expect(extract).toHaveBeenCalledTimes(1)
    expect(verifySha256).toHaveBeenCalledTimes(1)

    const manifest = JSON.parse(
      await readFile(join(root, 'state', 'resources', 'manifest.json'), 'utf8'),
    ) as { installed: Record<string, { detected_executables?: string[]; executable?: string }> }
    expect(manifest.installed['tool:yosys']).toMatchObject({
      version: '0.61',
      managed: true,
      size: archive.size,
      detected_executables: ['bin/yosys'],
      executable: 'bin/yosys',
    })
  })

  it('installs a zip-packaged Surfer web asset tool', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createSurferAssetsZip(root)
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'surfer',
          display_name: 'Surfer',
          description: 'Waveform viewer web assets',
          category: 'viewer',
          homepage: 'https://gitlab.com/surfer-project/surfer',
          versions: [
            {
              version: '0.7.0-ecos',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'surfer-web-assets',
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const verifySha256 = vi.fn(async () => true)
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      sha256Verifier: verifySha256,
    })

    await expect(service.installResource('tool:surfer', '0.7.0-ecos')).resolves.toEqual({
      status: 'started',
      resource_id: 'tool:surfer',
      version: '0.7.0-ecos',
    })

    const surferRoot = join(root, 'data', 'tools', 'surfer', '0.7.0-ecos')
    await expect(readFile(join(surferRoot, 'index.html'), 'utf8')).resolves.toContain('<!doctype html>')
    await expect(readFile(join(surferRoot, 'surfer.js'), 'utf8')).resolves.toContain('init')
    await expect(readFile(join(surferRoot, 'surfer_bg.wasm'), 'utf8')).resolves.toBe('wasm')

    const manifest = JSON.parse(
      await readFile(join(root, 'state', 'resources', 'manifest.json'), 'utf8'),
    ) as { installed: Record<string, { executable?: string; detected_executables?: string[] }> }
    expect(manifest.installed['tool:surfer']).toMatchObject({
      executable: 'index.html',
      detected_executables: [],
    })
    expect(verifySha256).toHaveBeenCalledTimes(1)
  })

  it('migrates old registry Surfer asset URLs to the release asset host', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createSurferAssetsZip(root)
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'surfer',
          display_name: 'Surfer',
          description: 'Waveform viewer web assets',
          category: 'viewer',
          homepage: 'https://gitlab.com/surfer-project/surfer',
          versions: [
            {
              version: '0.7.0-ecos',
              platforms: {
                'all-platform': {
                  url: 'https://raw.githubusercontent.com/Luyoung0001/ecos-registry/main/assets/surfer-web-assets-0.7.0-ecos.zip',
                  sha256: 'fixture-surfer-sha',
                  size: 1035,
                  strip_prefix: 'surfer-web-assets',
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://github.com/openecos-projects/ecos-resource-assets/releases/download/v0.7.0-ecos/surfer-web-assets-0.7.0-ecos.zip')
      return new Response(await readFile(archive.path), { status: 200 })
    })
    const verifySha256 = vi.fn(async () => true)
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      fetchImpl: fetchImpl as typeof fetch,
      sha256Verifier: verifySha256,
    })

    await expect(service.installResource('tool:surfer', '0.7.0-ecos')).resolves.toEqual({
      status: 'started',
      resource_id: 'tool:surfer',
      version: '0.7.0-ecos',
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(verifySha256).toHaveBeenCalledTimes(1)
  })

  it('lists and installs ecc-fe with its managed frontend resource dependency', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createEccFeArchive(root)
    const socArchive = await createEccFeSocArchive(root)
    const examplesArchive = await createEccFeExamplesArchive(root)
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'ecc-fe',
          display_name: 'ECC-FE Frontend Flow',
          description: 'Frontend flow runtime CLI',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: '0.1.0-alpha.0-ecos',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'ecc-fe-runtime',
                },
              },
              requires: ['tool:ecc-fe-soc-ysyx-am', 'tool:ecc-fe-examples'],
            },
          ],
        },
        {
          name: 'ecc-fe-soc-ysyx-am',
          display_name: 'ECC-FE YSYX AM SoC Harness',
          description: 'Frontend SoC harness resource',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: '0.1.0-alpha.0-ecos',
              platforms: {
                'all-platform': {
                  url: `file://${socArchive.path}`,
                  sha256: socArchive.sha256,
                  size: socArchive.size,
                  strip_prefix: 'ecc-fe-soc-ysyx-am',
                },
              },
              requires: [],
            },
          ],
        },
        {
          name: 'ecc-fe-examples',
          display_name: 'ECC-FE Examples',
          description: 'Frontend example projects',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: '0.1.0-alpha.0-ecos',
              platforms: {
                'all-platform': {
                  url: `file://${examplesArchive.path}`,
                  sha256: examplesArchive.sha256,
                  size: examplesArchive.size,
                  strip_prefix: 'ecc-fe-examples',
                },
              },
              requires: [],
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const verifySha256 = vi.fn(async () => true)
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      sha256Verifier: verifySha256,
    })
    const listedBefore = await service.listResources()

    expect(listedBefore.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tool:ecc-fe',
        requires: ['tool:ecc-fe-soc-ysyx-am', 'tool:ecc-fe-examples'],
        installed_requires: [],
        missing_requires: ['tool:ecc-fe-soc-ysyx-am', 'tool:ecc-fe-examples'],
      }),
    ]))

    await expect(service.installResource('tool:ecc-fe', '0.1.0-alpha.0-ecos')).resolves.toEqual({
      status: 'started',
      resource_id: 'tool:ecc-fe',
      version: '0.1.0-alpha.0-ecos',
    })

    const eccFeRoot = join(root, 'data', 'tools', 'ecc-fe', '0.1.0-alpha.0-ecos')
    const eccFeSocRoot = join(root, 'data', 'tools', 'ecc-fe-soc-ysyx-am', '0.1.0-alpha.0-ecos')
    const eccFeExamplesRoot = join(root, 'data', 'tools', 'ecc-fe-examples', '0.1.0-alpha.0-ecos')
    await expect(readFile(join(eccFeRoot, 'bin', 'ecc-fe'), 'utf8')).resolves.toContain('#!/bin/sh')
    await expect(readFile(join(eccFeRoot, 'fecompiler', '__init__.py'), 'utf8')).resolves.toBe('')
    await expect(readFile(join(eccFeSocRoot, 'ecos_sim_top.v'), 'utf8')).resolves.toContain('module ecos_sim_top')
    await expect(readFile(join(eccFeExamplesRoot, 'examples', 'cl3', 'filelist.cpu.f'), 'utf8')).resolves.toContain('CL3Top.sv')

    const manifest = JSON.parse(
      await readFile(join(root, 'state', 'resources', 'manifest.json'), 'utf8'),
    ) as { installed: Record<string, { executable?: string; detected_executables?: string[] }> }
    expect(manifest.installed['tool:ecc-fe']).toMatchObject({
      executable: 'bin/ecc-fe',
      detected_executables: ['bin/ecc-fe'],
    })
    expect(manifest.installed['tool:ecc-fe-soc-ysyx-am']).toMatchObject({
      executable: '',
      detected_executables: [],
    })
    expect(manifest.installed['tool:ecc-fe-examples']).toMatchObject({
      executable: '',
      detected_executables: [],
    })
    expect(verifySha256).toHaveBeenCalledTimes(3)

    const listedAfter = await service.listResources()
    expect(listedAfter.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tool:ecc-fe',
        installed_requires: ['tool:ecc-fe-soc-ysyx-am', 'tool:ecc-fe-examples'],
        missing_requires: [],
      }),
    ]))
  })

  it('waits for an active shared dependency job during concurrent resource updates', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createEccFeArchive(root)
    const socArchive = await createEccFeSocArchive(root)
    const cpuRtlArchive = await createEccFeCpuRtlArchive(root)
    const registryPath = join(root, 'registry.json')
    const resourcesDir = join(root, 'state', 'resources')
    const toolsDir = join(root, 'data', 'tools')
    await mkdir(join(toolsDir, 'ecc-fe', 'latest'), { recursive: true })
    await mkdir(join(toolsDir, 'ecc-fe-soc-ysyx-am', 'latest'), { recursive: true })
    await mkdir(resourcesDir, { recursive: true })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'ecc-fe',
          display_name: 'ECC-FE Frontend Flow',
          description: 'Frontend flow runtime CLI',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: 'latest',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'ecc-fe-runtime',
                },
              },
              requires: ['tool:ecc-fe-cpu-rtl'],
            },
          ],
        },
        {
          name: 'ecc-fe-soc-ysyx-am',
          display_name: 'ECC-FE YSYX AM SoC Harness',
          description: 'Frontend SoC harness resource',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: 'latest',
              platforms: {
                'all-platform': {
                  url: `file://${socArchive.path}`,
                  sha256: socArchive.sha256,
                  size: socArchive.size,
                  strip_prefix: 'ecc-fe-soc-ysyx-am',
                },
              },
              requires: ['tool:ecc-fe-cpu-rtl'],
            },
          ],
        },
        {
          name: 'ecc-fe-cpu-rtl',
          display_name: 'ECC-FE CPU RTL Resources',
          description: 'Frontend CPU RTL resource bundle',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: 'latest',
              platforms: {
                'all-platform': {
                  url: `file://${cpuRtlArchive.path}`,
                  sha256: cpuRtlArchive.sha256,
                  size: cpuRtlArchive.size,
                  strip_prefix: 'ecc-fe-cpu-rtl',
                },
              },
              requires: [],
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    await writeFile(join(resourcesDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:ecc-fe': {
          type: 'tool',
          name: 'ecc-fe',
          version: 'latest',
          path: join(toolsDir, 'ecc-fe', 'latest'),
          installed_at: '2026-06-30T00:00:00Z',
          sha256: 'old-ecc-fe-sha',
          executable: 'bin/ecc-fe',
          detected_executables: ['bin/ecc-fe'],
          active: true,
          managed: true,
        },
        'tool:ecc-fe-soc-ysyx-am': {
          type: 'tool',
          name: 'ecc-fe-soc-ysyx-am',
          version: 'latest',
          path: join(toolsDir, 'ecc-fe-soc-ysyx-am', 'latest'),
          installed_at: '2026-06-30T00:00:00Z',
          sha256: 'old-ecc-fe-soc-sha',
          executable: '',
          detected_executables: [],
          active: true,
          managed: true,
        },
      },
    }), 'utf8')

    const cpuExtractStarted = deferred()
    const releaseCpuExtract = deferred()
    const waitedForCpuJob = deferred()
    const extract = vi.fn(async (archivePath: string, destination: string) => {
      if (archivePath.includes('ecc-fe-cpu-rtl-latest')) {
        cpuExtractStarted.resolve()
        await releaseCpuExtract.promise
        await mkdir(join(destination, 'thirdparty', 'cv32e40p'), { recursive: true })
        await writeFile(join(destination, 'thirdparty', 'cv32e40p', 'README.md'), 'fixture cpu rtl\n', 'utf8')
        return
      }
      if (archivePath.includes('ecc-fe-soc-ysyx-am-latest')) {
        await mkdir(destination, { recursive: true })
        await writeFile(join(destination, 'ecos_sim_top.v'), 'module ecos_sim_top; endmodule\n', 'utf8')
        return
      }
      if (archivePath.includes('ecc-fe-latest')) {
        await mkdir(join(destination, 'bin'), { recursive: true })
        const executable = join(destination, 'bin', 'ecc-fe')
        await writeFile(executable, '#!/bin/sh\n', 'utf8')
        await chmod(executable, 0o755)
        return
      }
      throw new Error(`unexpected archive ${archivePath}`)
    })
    const verifySha256 = vi.fn(async () => true)
    const progress = vi.fn((event: { resource_id: string; phase: string }) => {
      if (event.resource_id === 'tool:ecc-fe-cpu-rtl' && event.phase === 'waiting_for_active_job') {
        waitedForCpuJob.resolve()
      }
    })
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir,
      toolsDir,
      pdksDir: join(root, 'data', 'pdks'),
      archiveExtractor: extract,
      sha256Verifier: verifySha256,
    })

    const firstUpdate = service.updateResource('tool:ecc-fe', progress)
    await withTimeout(cpuExtractStarted.promise, 2000)
    const secondUpdate = service.updateResource('tool:ecc-fe-soc-ysyx-am', progress)

    let waitError: unknown = null
    try {
      await withTimeout(waitedForCpuJob.promise, 2000)
    } catch (error) {
      waitError = error
    } finally {
      releaseCpuExtract.resolve()
    }
    await expect(Promise.all([firstUpdate, secondUpdate])).resolves.toEqual([
      {
        status: 'started',
        resource_id: 'tool:ecc-fe',
        version: 'latest',
      },
      {
        status: 'started',
        resource_id: 'tool:ecc-fe-soc-ysyx-am',
        version: 'latest',
      },
    ])
    if (waitError) throw waitError

    const cpuExtractCalls = extract.mock.calls.filter(([archivePath]) => {
      return archivePath.includes('ecc-fe-cpu-rtl-latest')
    })
    expect(cpuExtractCalls).toHaveLength(1)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      resource_id: 'tool:ecc-fe-cpu-rtl',
      phase: 'waiting_for_active_job',
    }))
    const manifest = JSON.parse(
      await readFile(join(resourcesDir, 'manifest.json'), 'utf8'),
    ) as { installed: Record<string, { version?: string; sha256?: string; detected_executables?: string[] }> }
    expect(manifest.installed['tool:ecc-fe']).toMatchObject({
      version: 'latest',
      sha256: archive.sha256,
    })
    expect(manifest.installed['tool:ecc-fe-soc-ysyx-am']).toMatchObject({
      version: 'latest',
      sha256: socArchive.sha256,
    })
    expect(manifest.installed['tool:ecc-fe-cpu-rtl']).toMatchObject({
      version: 'latest',
      sha256: cpuRtlArchive.sha256,
      detected_executables: [],
    })
  })

  it('does not fetch rolling release sidecars while listing resources', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createEccFeArchive(root)
    const registryPath = join(root, 'registry.json')
    const resourcesDir = join(root, 'state', 'resources')
    const toolsDir = join(root, 'data', 'tools')
    const metadataUrl = 'https://example.com/ecc-fe-latest.metadata.json'
    const shaUrl = 'https://example.com/ecc-fe-latest.tar.gz.sha256'
    await mkdir(resourcesDir, { recursive: true })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'ecc-fe',
          display_name: 'ECC-FE Frontend Flow',
          description: 'Frontend flow runtime CLI',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: 'latest',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  metadata_url: metadataUrl,
                  sha256_url: shaUrl,
                  sha256: 'b'.repeat(64),
                  size: 1,
                  strip_prefix: 'ecc-fe-runtime',
                },
              },
              requires: [],
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    await writeFile(join(resourcesDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:ecc-fe': {
          type: 'tool',
          name: 'ecc-fe',
          version: 'latest',
          path: join(toolsDir, 'ecc-fe', 'latest'),
          installed_at: '2026-06-30T00:00:00Z',
          sha256: 'c'.repeat(64),
          size: 1,
          executable: 'bin/ecc-fe',
          detected_executables: ['bin/ecc-fe'],
          active: true,
          managed: true,
        },
      },
    }), 'utf8')
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      throw new Error(`unexpected fetch ${String(url)}`)
    })
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir,
      toolsDir,
      pdksDir: join(root, 'data', 'pdks'),
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(service.getResource('tool:ecc-fe')).resolves.toMatchObject({
      status: 'installed',
      installed_version: 'latest',
      available_versions: ['latest'],
      size: 1,
      actions: ['uninstall'],
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('checks rolling release sha256 sidecars manually and then marks latest tools as updatable', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createEccFeArchive(root)
    const registryPath = join(root, 'registry.json')
    const resourcesDir = join(root, 'state', 'resources')
    const toolsDir = join(root, 'data', 'tools')
    const shaUrl = 'https://example.com/ecc-fe-latest.tar.gz.sha256'
    const installedSha = 'c'.repeat(64)
    const latestSha = 'd'.repeat(64)
    await mkdir(resourcesDir, { recursive: true })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'ecc-fe',
          display_name: 'ECC-FE Frontend Flow',
          description: 'Frontend flow runtime CLI',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: 'latest',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256_url: shaUrl,
                  strip_prefix: 'ecc-fe-runtime',
                },
              },
              requires: [],
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    await writeFile(join(resourcesDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:ecc-fe': {
          type: 'tool',
          name: 'ecc-fe',
          version: 'latest',
          path: join(toolsDir, 'ecc-fe', 'latest'),
          installed_at: '2026-06-30T00:00:00Z',
          sha256: installedSha,
          executable: 'bin/ecc-fe',
          detected_executables: ['bin/ecc-fe'],
          active: true,
          managed: true,
        },
      },
    }), 'utf8')
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url)
      if (requestUrl === shaUrl) {
        return new Response(`${latestSha}  ecc-fe-latest.tar.gz\n`, { status: 200 })
      }
      throw new Error(`unexpected fetch ${requestUrl}`)
    })
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir,
      toolsDir,
      cacheDir: join(root, 'cache'),
      pdksDir: join(root, 'data', 'pdks'),
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(service.getResource('tool:ecc-fe')).resolves.toMatchObject({
      status: 'installed',
      actions: ['uninstall'],
    })

    await expect(service.checkResourceUpdates({ force: true })).resolves.toMatchObject({
      status: 'ok',
      checked_count: 1,
      update_count: 1,
      resources: [
        expect.objectContaining({
          resource_id: 'tool:ecc-fe',
          sha256: latestSha,
          status: 'checked',
          update_available: true,
        }),
      ],
    })

    await expect(service.getResource('tool:ecc-fe')).resolves.toMatchObject({
      status: 'update_available',
      actions: ['update', 'uninstall'],
      health: expect.objectContaining({
        update_check: expect.objectContaining({
          sha256: latestSha,
          update_url: shaUrl,
          status: 'checked',
        }),
      }),
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('checks rolling release metadata manually and then marks latest tools as updatable', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createEccFeArchive(root)
    const registryPath = join(root, 'registry.json')
    const resourcesDir = join(root, 'state', 'resources')
    const toolsDir = join(root, 'data', 'tools')
    const metadataUrl = 'https://example.com/ecc-fe-latest.metadata.json'
    const installedSha = 'c'.repeat(64)
    const latestSha = 'd'.repeat(64)
    await mkdir(resourcesDir, { recursive: true })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'ecc-fe',
          display_name: 'ECC-FE Frontend Flow',
          description: 'Frontend flow runtime CLI',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: 'latest',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  metadata_url: metadataUrl,
                  sha256: 'b'.repeat(64),
                  size: 1,
                  strip_prefix: 'ecc-fe-runtime',
                },
              },
              requires: [],
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    await writeFile(join(resourcesDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:ecc-fe': {
          type: 'tool',
          name: 'ecc-fe',
          version: 'latest',
          path: join(toolsDir, 'ecc-fe', 'latest'),
          installed_at: '2026-06-30T00:00:00Z',
          sha256: installedSha,
          executable: 'bin/ecc-fe',
          detected_executables: ['bin/ecc-fe'],
          active: true,
          managed: true,
        },
      },
    }), 'utf8')
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url)
      if (requestUrl === metadataUrl) {
        return new Response(JSON.stringify({
          sha256: latestSha,
          size: archive.size,
          commit: 'abcdef0',
          built_at: '2026-06-30T00:00:00Z',
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${requestUrl}`)
    })
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir,
      toolsDir,
      cacheDir: join(root, 'cache'),
      pdksDir: join(root, 'data', 'pdks'),
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(service.checkResourceUpdates({ force: true })).resolves.toMatchObject({
      status: 'ok',
      checked_count: 1,
      update_count: 1,
      resources: [
        expect.objectContaining({
          resource_id: 'tool:ecc-fe',
          sha256: latestSha,
          status: 'checked',
          update_available: true,
        }),
      ],
    })

    await expect(service.getResource('tool:ecc-fe')).resolves.toMatchObject({
      status: 'update_available',
      actions: ['update', 'uninstall'],
      health: expect.objectContaining({
        update_check: expect.objectContaining({
          sha256: latestSha,
          update_url: metadataUrl,
          status: 'checked',
        }),
      }),
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('uses latest release metadata to verify ecc-fe downloads', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createEccFeArchive(root)
    const registryPath = join(root, 'registry.json')
    const resourcesDir = join(root, 'state', 'resources')
    const toolsDir = join(root, 'data', 'tools')
    const metadataUrl = 'https://example.com/ecc-fe-latest.metadata.json'
    const shaUrl = 'https://example.com/ecc-fe-latest.tar.gz.sha256'
    const latestSha = 'a'.repeat(64)
    await mkdir(resourcesDir, { recursive: true })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'ecc-fe',
          display_name: 'ECC-FE Frontend Flow',
          description: 'Frontend flow runtime CLI',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: 'latest',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  metadata_url: metadataUrl,
                  sha256_url: shaUrl,
                  sha256: 'b'.repeat(64),
                  size: 1,
                  strip_prefix: 'ecc-fe-runtime',
                },
              },
              requires: [],
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    await writeFile(join(resourcesDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:ecc-fe': {
          type: 'tool',
          name: 'ecc-fe',
          version: 'latest',
          path: join(toolsDir, 'ecc-fe', 'latest'),
          installed_at: '2026-06-30T00:00:00Z',
          sha256: 'c'.repeat(64),
          size: 1,
          executable: 'bin/ecc-fe',
          detected_executables: ['bin/ecc-fe'],
          active: true,
          managed: true,
        },
      },
    }), 'utf8')
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url)
      if (requestUrl === metadataUrl) {
        return new Response(JSON.stringify({
          sha256: latestSha,
          size: archive.size,
          commit: 'abcdef0',
          built_at: '2026-06-30T00:00:00Z',
        }), { status: 200 })
      }
      if (requestUrl === shaUrl) {
        return new Response(`${latestSha}  ecc-fe-latest.tar.gz\n`, { status: 200 })
      }
      throw new Error(`unexpected fetch ${requestUrl}`)
    })
    const verifySha256 = vi.fn(async (_path: string, expected: string) => expected === latestSha)
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir,
      toolsDir,
      pdksDir: join(root, 'data', 'pdks'),
      fetchImpl: fetchImpl as typeof fetch,
      sha256Verifier: verifySha256,
    })

    await expect(service.updateResource('tool:ecc-fe')).resolves.toEqual({
      status: 'started',
      resource_id: 'tool:ecc-fe',
      version: 'latest',
    })

    const manifest = JSON.parse(
      await readFile(join(resourcesDir, 'manifest.json'), 'utf8'),
    ) as { installed: Record<string, { sha256?: string; size?: number; version?: string }> }
    expect(manifest.installed['tool:ecc-fe']).toMatchObject({
      version: 'latest',
      sha256: latestSha,
      size: archive.size,
    })
    expect(verifySha256).toHaveBeenCalledWith(expect.any(String), latestSha)
  })

  it('does not use registry static sha to decide rolling latest updates while listing', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createEccFeArchive(root)
    const registryPath = join(root, 'registry.json')
    const resourcesDir = join(root, 'state', 'resources')
    const toolsDir = join(root, 'data', 'tools')
    const metadataUrl = 'https://example.com/ecc-fe-latest.metadata.json'
    const registrySha = 'b'.repeat(64)
    const latestSha = 'd'.repeat(64)
    await mkdir(resourcesDir, { recursive: true })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'ecc-fe',
          display_name: 'ECC-FE Frontend Flow',
          description: 'Frontend flow runtime CLI',
          category: 'frontend',
          homepage: 'https://github.com/openecos-projects/ecc-fe',
          versions: [
            {
              version: 'latest',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  metadata_url: metadataUrl,
                  sha256: registrySha,
                  size: 1,
                  strip_prefix: 'ecc-fe-runtime',
                },
              },
              requires: [],
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    await writeFile(join(resourcesDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:ecc-fe': {
          type: 'tool',
          name: 'ecc-fe',
          version: 'latest',
          path: join(toolsDir, 'ecc-fe', 'latest'),
          installed_at: '2026-06-30T00:00:00Z',
          sha256: registrySha,
          size: 1,
          executable: 'bin/ecc-fe',
          detected_executables: ['bin/ecc-fe'],
          active: true,
          managed: true,
        },
      },
    }), 'utf8')
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      sha256: latestSha,
      size: archive.size,
      commit: 'abcdef0',
      built_at: '2026-06-30T00:00:00Z',
    }), { status: 200 }))
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir,
      toolsDir,
      pdksDir: join(root, 'data', 'pdks'),
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(service.getResource('tool:ecc-fe')).resolves.toMatchObject({
      status: 'installed',
      installed_version: 'latest',
      available_versions: ['latest'],
      size: 1,
      actions: ['uninstall'],
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('streams remote downloads and emits byte progress while downloading a managed tool', async () => {
    const root = await createTempDir('ecos-resources-')
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'yosys',
          display_name: 'Yosys',
          description: 'RTL synthesis',
          category: 'synthesis',
          homepage: '',
          versions: [
            {
              version: '0.61',
              platforms: {
                'all-platform': {
                  url: 'https://example.com/yosys.tar',
                  sha256: 'fixture-sha',
                  size: 9,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
    ]
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://example.com/yosys.tar')
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(chunk)
            }
            controller.close()
          },
        }),
        {
          status: 200,
        },
      )
    })
    const extract = vi.fn(async (_archivePath: string, destination: string) => {
      await mkdir(join(destination, 'bin'), { recursive: true })
      const executable = join(destination, 'bin', 'yosys')
      await writeFile(executable, '#!/bin/sh\n', 'utf8')
      await chmod(executable, 0o755)
    })
    const verifySha256 = vi.fn(async () => true)
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      archiveExtractor: extract,
      fetchImpl: fetchImpl as typeof fetch,
      sha256Verifier: verifySha256,
    })
    const progress = vi.fn()

    await service.installResource('tool:yosys', '0.61', progress)

    const extractingEvents = progress.mock.calls
      .map(([event]) => event)
      .filter((event) => event.phase === 'extracting')
    expect(extractingEvents).not.toContainEqual(expect.objectContaining({
      progress: 0,
    }))
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'downloading',
      progress: 1 / 3,
    }))
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'downloading',
      progress: 2 / 3,
    }))
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'downloading',
      progress: 1,
    }))
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'extracting',
      progress: 0.05,
    }))
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'extracting',
      progress: 0.98,
    }))
  })

  it('reports the source URL and network cause when a tool download fails before a response', async () => {
    const root = await createTempDir('ecos-resources-')
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'yosys',
          display_name: 'Yosys',
          description: 'RTL synthesis',
          category: 'synthesis',
          homepage: '',
          versions: [
            {
              version: '0.61',
              platforms: {
                'all-platform': {
                  url: 'https://github.com/YosysHQ/oss-cad-suite-build/releases/download/0.61/yosys.tar',
                  sha256: '',
                  size: 20,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const cause = Object.assign(new Error('Connect Timeout Error'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    })
    const fetchError = Object.assign(new TypeError('fetch failed'), { cause })
    const fetchImpl = vi.fn(async () => {
      throw fetchError
    }) as unknown as typeof fetch
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      fetchImpl,
    })
    const progress = vi.fn()
    const expectedMessage = 'Failed to download https://github.com/YosysHQ/oss-cad-suite-build/releases/download/0.61/yosys.tar: fetch failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error)'

    await expect(service.installResource('tool:yosys', '0.61', progress)).rejects.toThrow(expectedMessage)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'error',
      message: expectedMessage,
      error: expectedMessage,
    }))
  })

  it('cancels an active tool download and removes temporary downloads', async () => {
    const root = await createTempDir('ecos-resources-')
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'yosys',
          display_name: 'Yosys',
          description: 'RTL synthesis',
          category: 'synthesis',
          homepage: '',
          versions: [
            {
              version: '0.61',
              platforms: {
                'all-platform': {
                  url: 'https://example.com/yosys.tar',
                  sha256: '',
                  size: 9,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    let started = false
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        controller?.error(new DOMException('The operation was aborted.', 'AbortError'))
      })
      return new Response(
        new ReadableStream<Uint8Array>({
          start(nextController) {
            started = true
            controller = nextController
            nextController.enqueue(new Uint8Array([1, 2, 3]))
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      fetchImpl,
    })
    const progress = vi.fn()

    const install = service.installResource('tool:yosys', '0.61', progress)
    await vi.waitFor(() => {
      expect(started).toBe(true)
    })

    await expect(service.cancelResource('tool:yosys')).resolves.toEqual({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })
    await expect(install).rejects.toThrow('Cancelled download for tool:yosys')
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      resource_id: 'tool:yosys',
      phase: 'cancelled',
      message: 'Cancelled download for tool:yosys',
      error: 'Cancelled download for tool:yosys',
    }))
    await expect(readdir(join(root, 'state', 'resources', 'downloads'))).resolves.toEqual([])
  })

  it('returns cached registry data immediately and refreshes the registry in the background', async () => {
    const root = await createTempDir('ecos-resources-')
    const cacheDir = join(root, 'cache')
    const registryUrl = 'https://example.com/registry.json'
    await mkdir(cacheDir, { recursive: true })
    await writeFile(testRegistryCachePath(cacheDir, registryUrl), JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'cached-yosys',
          display_name: 'Cached Yosys',
          description: 'Cached synthesis tool',
          category: 'synthesis',
          homepage: '',
          versions: [
            {
              version: '0.61',
              platforms: {
                'all-platform': {
                  url: 'file:///tmp/cached-yosys.tar',
                  sha256: 'fixture-sha',
                  size: 9,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}))
    const service = new ResourceManagerService({
      registryUrl,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      cacheDir,
      fetchImpl: fetchImpl as typeof fetch,
    })

    const result = await withTimeout(service.listResources(), 100)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.diagnostics).toContain('Using cached registry data while refreshing in background')
    expect(result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tool:cached-yosys',
        display_name: 'Cached Yosys',
      }),
    ]))
  })

  it('installs a managed registry PDK with strip prefix and post-install steps', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createPdkArchive(root)
    const registryPath = join(root, 'registry.json')
    const postInstallRunner = vi.fn(async (command: string, args: string[], options?: { cwd?: string }) => {
      expect(command).toBe('make')
      expect(args).toEqual(['unzip'])
      expect(options?.cwd).toContain(`${join('data', 'pdks', 'ics55')}`)
      await writeFile(join(options?.cwd ?? root, 'post-install-ran.txt'), 'ok\n', 'utf8')
    })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [],
      pdks: [
        {
          id: 'ics55',
          display_name: 'ICsprout 55nm PDK',
          description: 'ICsprout 55nm open-source process design kit.',
          category: 'pdk',
          homepage: 'https://example.com/ics55',
          versions: [
            {
              version: '1.10.100',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'icsprout55-pdk-1.10.100',
                  post_install: [
                    {
                      command: ['make', 'unzip'],
                      cwd: '.',
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    }), 'utf8')
    const verifySha256 = vi.fn(async () => true)
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      commandRunner: postInstallRunner,
      sha256Verifier: verifySha256,
    })
    const progress = vi.fn()

    await expect(service.installResource('pdk:ics55', '1.10.100', progress)).resolves.toEqual({
      status: 'started',
      resource_id: 'pdk:ics55',
      version: '1.10.100',
    })

    const destination = join(root, 'data', 'pdks', 'ics55', '1.10.100')
    const installed = await service.getResource('pdk:ics55')
    expect(installed).toMatchObject({
      id: 'pdk:ics55',
      type: 'pdk',
      status: 'installed',
      installed_version: '1.10.100',
      active: true,
      active_version: '1.10.100',
      path: destination,
      managed_root: join(root, 'data', 'pdks'),
      size: archive.size,
      source: 'registry',
      actions: ['validate', 'uninstall'],
      health: expect.objectContaining({
        managed: true,
        source: 'registry',
        source_url: `file://${archive.path}`,
        sha256: archive.sha256,
      }),
    })
    await expect(readFile(join(destination, 'post-install-ran.txt'), 'utf8')).resolves.toBe('ok\n')
    expect(postInstallRunner).toHaveBeenCalledWith(
      'make',
      ['unzip'],
      expect.objectContaining({ cwd: expect.stringContaining(`${join('data', 'pdks', 'ics55')}`) }),
    )
    expect(verifySha256).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      resource_id: 'pdk:ics55',
      phase: 'post_install',
    }))
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      resource_id: 'pdk:ics55',
      phase: 'done',
      progress: 1,
    }))

    const manifest = JSON.parse(
      await readFile(join(root, 'state', 'resources', 'manifest.json'), 'utf8'),
    ) as { installed: Record<string, unknown> }
    expect(manifest.installed['pdk:ics55']).toMatchObject({
      type: 'pdk',
      id: 'ics55',
      name: 'ics55',
      pdk_id: 'ics55',
      version: '1.10.100',
      sha256: archive.sha256,
      size: archive.size,
      source: 'registry',
      source_url: `file://${archive.path}`,
      canonical_path: destination,
      path: destination,
      active: true,
      managed: true,
      health: 'ok',
      detected_file_groups: {
        directories: ['IP', 'prtech'],
        files: ['README.md', 'post-install-ran.txt'],
      },
    })
  })

  it('marks managed registry PDKs updateable and updates them through the PDK install path', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createPdkArchive(root)
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [],
      pdks: [
        {
          id: 'ics55',
          display_name: 'ICsprout 55nm PDK',
          description: 'ICsprout 55nm open-source process design kit.',
          category: 'pdk',
          homepage: 'https://example.com/ics55',
          versions: [
            {
              version: '1.10.101',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'icsprout55-pdk-1.10.100',
                },
              },
            },
            {
              version: '1.10.100',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'icsprout55-pdk-1.10.100',
                },
              },
            },
          ],
        },
      ],
    }), 'utf8')
    await mkdir(join(root, 'state', 'resources'), { recursive: true })
    await writeFile(join(root, 'state', 'resources', 'manifest.json'), JSON.stringify({
      schema_version: 1,
      resources_dir: join(root, 'state', 'resources'),
      tools_dir: join(root, 'data', 'tools'),
      pdks_dir: join(root, 'data', 'pdks'),
      installed: {
        'pdk:ics55': {
          type: 'pdk',
          id: 'ics55',
          name: 'ics55',
          pdk_id: 'ics55',
          version: '1.10.100',
          sha256: 'old-sha',
          source: 'registry',
          source_url: 'file:///old/ics55.tar',
          canonical_path: join(root, 'data', 'pdks', 'ics55', '1.10.100'),
          path: join(root, 'data', 'pdks', 'ics55', '1.10.100'),
          detected_files: ['IP', 'prtech'],
          detected_file_groups: {
            directories: ['IP', 'prtech'],
            files: [],
          },
          imported_at: '2026-01-01T00:00:00Z',
          active: true,
          managed: true,
          health: 'ok',
        },
      },
    }), 'utf8')
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      sha256Verifier: vi.fn(async () => true),
    })

    await expect(service.getResource('pdk:ics55')).resolves.toMatchObject({
      status: 'update_available',
      installed_version: '1.10.100',
      available_versions: ['1.10.101', '1.10.100'],
      active: true,
      size: archive.size,
      actions: ['validate', 'update', 'uninstall'],
    })
    await expect(service.updateResource('pdk:ics55')).resolves.toEqual({
      status: 'started',
      resource_id: 'pdk:ics55',
      version: '1.10.101',
    })
    await expect(service.getResource('pdk:ics55')).resolves.toMatchObject({
      status: 'installed',
      installed_version: '1.10.101',
      active: true,
      active_version: '1.10.101',
      size: archive.size,
      actions: ['validate', 'uninstall'],
    })
  })

  it('pre-downloads PDK release assets before running Makefile post-install steps', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createPdkArchive(root, {
      makefileContent: [
        'RELEASE_FILE_LIB := ics55_mock_liberty.tar.bz2 \\',
        '                    ics55_mock_gds.tar.bz2',
        'RELEASE_FILE := $(RELEASE_FILE_LIB)',
        '',
        'unzip:',
        '\t@echo unzip',
        '',
      ].join('\n'),
    })
    const archiveBytes = await readFile(archive.path)
    const registryPath = join(root, 'registry.json')
    const archiveUrl = 'https://github.com/openecos-projects/icsprout55-pdk/archive/refs/tags/v1.10.100.tar.gz'
    const fetchedUrls: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url)
      fetchedUrls.push(requestUrl)
      if (requestUrl === archiveUrl) {
        return new Response(archiveBytes)
      }
      return new Response(new TextEncoder().encode(`payload for ${requestUrl}`))
    })
    const postInstallRunner = vi.fn(async (_command: string, _args: string[], options?: { cwd?: string }) => {
      const cwd = options?.cwd ?? root
      await expect(readFile(join(cwd, 'ics55_mock_liberty.tar.bz2'), 'utf8')).resolves.toContain('payload for')
      await expect(readFile(join(cwd, 'ics55_mock_gds.tar.bz2'), 'utf8')).resolves.toContain('payload for')
    })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [],
      pdks: [
        {
          id: 'ics55',
          display_name: 'ICsprout 55nm PDK',
          versions: [
            {
              version: '1.10.100',
              platforms: {
                'all-platform': {
                  url: archiveUrl,
                  sha256: 'fixture-pdk-sha',
                  size: archiveBytes.byteLength,
                  strip_prefix: 'icsprout55-pdk-1.10.100',
                  post_install: [
                    {
                      command: ['make', 'unzip'],
                      cwd: '.',
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    }), 'utf8')
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      commandRunner: postInstallRunner,
      fetchImpl: fetchImpl as typeof fetch,
      sha256Verifier: vi.fn(async () => true),
    })

    await service.installResource('pdk:ics55', '1.10.100')

    expect(fetchedUrls).toEqual(expect.arrayContaining([
      archiveUrl,
      'https://github.com/openecos-projects/icsprout55-pdk/releases/download/v1.10.100/ics55_mock_liberty.tar.bz2',
      'https://github.com/openecos-projects/icsprout55-pdk/releases/download/v1.10.100/ics55_mock_gds.tar.bz2',
    ]))
    expect(postInstallRunner).toHaveBeenCalledTimes(1)
  })

  it('keeps post-install command failures concise when commands emit large output', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createPdkArchive(root)
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [],
      pdks: [
        {
          id: 'ics55',
          display_name: 'ICsprout 55nm PDK',
          versions: [
            {
              version: '1.10.100',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'icsprout55-pdk-1.10.100',
                  post_install: [
                    {
                      command: [
                        process.execPath,
                        '-e',
                        "process.stderr.write('x'.repeat(12000)); process.exit(7)",
                      ],
                      cwd: '.',
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    }), 'utf8')
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      sha256Verifier: vi.fn(async () => true),
    })

    try {
      await service.installResource('pdk:ics55', '1.10.100')
      throw new Error('Expected post-install command to fail')
    } catch (error) {
      expect(error).toEqual(expect.objectContaining({
        message: expect.stringMatching(/failed with exit code 7/),
      }))
      expect(error).toEqual(expect.objectContaining({
        message: expect.not.stringMatching(/x{10000}/),
      }))
      expect(error).toEqual(expect.objectContaining({
        message: expect.not.stringMatching(/x{3000}/),
      }))
    }
  })
})
