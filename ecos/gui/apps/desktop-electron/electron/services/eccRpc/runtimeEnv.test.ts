import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createEccRuntimeEnv,
  resolveEccExecutable,
  runtimeBinPathEnvVariable,
  userZdotdirEnvVariable,
} from './runtimeEnv'

function createRepoFixture(): {
  appPath: string
  repoRoot: string
  userDataPath: string
} {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ecos-studio-'))
  const appPath = join(repoRoot, 'ecos', 'gui', 'apps', 'desktop-electron')
  const userDataPath = join(repoRoot, 'user-data')

  mkdirSync(join(repoRoot, 'ecc'), { recursive: true })
  mkdirSync(appPath, { recursive: true })
  mkdirSync(userDataPath, { recursive: true })

  return { appPath, repoRoot, userDataPath }
}

describe('createEccRuntimeEnv', () => {
  it('prepends a repo ecc development shim when the submodule exists', () => {
    const fixture = createRepoFixture()
    mkdirSync(join(fixture.repoRoot, 'ecc'), { recursive: true })
    const pyprojectPath = join(fixture.repoRoot, 'ecc', 'pyproject.toml')
    writeFileSync(pyprojectPath, '[project]\nname = "ecc"\n')
    const wrapperPath = join(fixture.repoRoot, 'ecos', 'scripts')
    mkdirSync(wrapperPath, { recursive: true })
    writeFileSync(join(wrapperPath, 'ecc-wrapper.sh'), '#!/usr/bin/env bash\n')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        HOME: '/home/ecos',
        PATH: '/home/ecos/.local/ecos/ecc:/usr/bin',
      },
      isPackaged: false,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    const runtimeBin = join(fixture.userDataPath, 'runtime-bin')
    const shimPath = join(runtimeBin, 'ecc')

    expect(env.PATH).toBe(`${runtimeBin}:/home/ecos/.local/ecos/ecc:/usr/bin`)
    expect(env[runtimeBinPathEnvVariable]).toBe(runtimeBin)
    expect(existsSync(shimPath)).toBe(true)
  })

  it('uses the repo ecc wrapper even when a venv exists', () => {
    const fixture = createRepoFixture()
    writeFileSync(
      join(fixture.repoRoot, 'ecc', 'pyproject.toml'),
      '[project]\nname = "ecc"\n',
    )
    const venvBin = join(fixture.repoRoot, 'ecc', '.venv', 'bin')
    mkdirSync(venvBin, { recursive: true })
    writeFileSync(join(venvBin, 'ecc'), '#!/usr/bin/env bash\n')
    const wrapperDir = join(fixture.repoRoot, 'ecos', 'scripts')
    mkdirSync(wrapperDir, { recursive: true })
    writeFileSync(join(wrapperDir, 'ecc-wrapper.sh'), '#!/usr/bin/env bash\n')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        PATH: '/home/ecos/.local/ecos/ecc:/usr/bin',
      },
      isPackaged: false,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env.PATH).toBe(
      `${join(fixture.userDataPath, 'runtime-bin')}:/home/ecos/.local/ecos/ecc:/usr/bin`,
    )
  })

  it('leaves Windows development env unchanged', () => {
    const fixture = createRepoFixture()
    writeFileSync(join(fixture.repoRoot, 'ecc', 'pyproject.toml'), '')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        PATH: 'C:\\Windows\\System32',
      },
      isPackaged: false,
      platform: 'win32',
      userDataPath: fixture.userDataPath,
    })

    const wrapperPath = join(fixture.userDataPath, 'runtime-bin', 'ecc.cmd')

    expect(env).toEqual({
      PATH: 'C:\\Windows\\System32',
    })
    expect(existsSync(wrapperPath)).toBe(false)
  })

  it('preserves the original Windows Path variable casing in development mode', () => {
    const fixture = createRepoFixture()
    writeFileSync(join(fixture.repoRoot, 'ecc', 'pyproject.toml'), '')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        Path: 'C:\\Windows\\System32',
      },
      isPackaged: false,
      platform: 'win32',
      userDataPath: fixture.userDataPath,
    })

    expect(env.Path).toBe('C:\\Windows\\System32')
    expect(env.PATH).toBeUndefined()
  })

  it('leaves env unchanged when no ecc submodule is found', () => {
    const root = mkdtempSync(join(tmpdir(), 'ecos-studio-missing-ecc-'))
    const appPath = join(root, 'ecos', 'gui', 'apps', 'desktop-electron')
    const userDataPath = join(root, 'user-data')
    mkdirSync(appPath, { recursive: true })
    mkdirSync(userDataPath, { recursive: true })

    const env = createEccRuntimeEnv({
      appPath,
      cwd: appPath,
      env: {
        PATH: '/usr/bin',
      },
      isPackaged: false,
      platform: 'linux',
      userDataPath,
    })

    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('drops an inherited runtime bin path marker when no ecc bin dir is prepended', () => {
    const root = mkdtempSync(join(tmpdir(), 'ecos-studio-stale-marker-'))
    const appPath = join(root, 'ecos', 'gui', 'apps', 'desktop-electron')
    const userDataPath = join(root, 'user-data')
    mkdirSync(appPath, { recursive: true })
    mkdirSync(userDataPath, { recursive: true })

    const env = createEccRuntimeEnv({
      appPath,
      cwd: appPath,
      env: {
        PATH: '/usr/bin',
        [runtimeBinPathEnvVariable]: '/stale/runtime-bin',
        [userZdotdirEnvVariable]: '/stale/zdotdir',
      },
      isPackaged: false,
      platform: 'linux',
      userDataPath,
    })

    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('prepends packaged runtime binaries when packaged resources include ecc', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const packagedEcc = join(resourcesPath, 'binaries', 'ecc')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    writeFileSync(packagedEcc, '#!/usr/bin/env bash\n')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env.PATH).toBe(`${join(resourcesPath, 'binaries')}:/usr/bin`)
    expect(env[runtimeBinPathEnvVariable]).toBe(join(resourcesPath, 'binaries'))
  })

  it('adds packaged ECC libraries for geometry snapshot subprocesses on Linux', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const binariesPath = join(resourcesPath, 'binaries')
    mkdirSync(join(binariesPath, '_internal', 'ecc_tools_bin', 'lib'), {
      recursive: true,
    })
    writeFileSync(join(binariesPath, 'ecc'), '#!/usr/bin/env bash\n')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        LD_LIBRARY_PATH: '/usr/local/lib',
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env.LD_LIBRARY_PATH).toBe(
      `${join(binariesPath, '_internal', 'ecc_tools_bin', 'lib')}:/usr/local/lib`,
    )
  })

  it('adds packaged ECC libraries even when only chip viewer subprocesses are bundled', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const binariesPath = join(resourcesPath, 'binaries')
    mkdirSync(join(binariesPath, '_internal', 'ecc_tools_bin', 'lib'), {
      recursive: true,
    })

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env.PATH).toBe('/usr/bin')
    expect(env.LD_LIBRARY_PATH).toBe(
      join(binariesPath, '_internal', 'ecc_tools_bin', 'lib'),
    )
  })

  it('does not inject bundled OSS CAD env when packaged resources include yosys', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const ossCadRoot = join(resourcesPath, 'resources', 'oss-cad-suite')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    mkdirSync(join(ossCadRoot, 'bin'), { recursive: true })
    writeFileSync(join(resourcesPath, 'binaries', 'ecc'), '#!/usr/bin/env bash\n')
    writeFileSync(join(ossCadRoot, 'bin', 'yosys'), '#!/usr/bin/env bash\n')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env.PATH).toBe(`${join(resourcesPath, 'binaries')}:/usr/bin`)
    expect(env.CHIPCOMPILER_OSS_CAD_DIR).toBeUndefined()
    expect(env.ECOS_ELECTRON_OSS_CAD_DIR).toBeUndefined()
  })

  it('removes inherited host OSS CAD vars in packaged mode', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const ossCadRoot = join(resourcesPath, 'resources', 'oss-cad-suite')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    mkdirSync(join(ossCadRoot, 'bin'), { recursive: true })
    writeFileSync(join(resourcesPath, 'binaries', 'ecc'), '#!/usr/bin/env bash\n')
    writeFileSync(join(ossCadRoot, 'bin', 'yosys'), '#!/usr/bin/env bash\n')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        CHIPCOMPILER_OSS_CAD_DIR: '/host/oss-cad-suite',
        ECOS_ELECTRON_OSS_CAD_DIR: '/host/electron-oss-cad-suite',
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env.CHIPCOMPILER_OSS_CAD_DIR).toBeUndefined()
    expect(env.ECOS_ELECTRON_OSS_CAD_DIR).toBeUndefined()
  })

  it('does not inject OSS CAD env when packaged yosys is missing', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const ossCadRoot = join(resourcesPath, 'resources', 'oss-cad-suite')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    mkdirSync(ossCadRoot, { recursive: true })
    writeFileSync(join(resourcesPath, 'binaries', 'ecc'), '#!/usr/bin/env bash\n')
    writeFileSync(join(ossCadRoot, 'placeholder.txt'), '')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env.CHIPCOMPILER_OSS_CAD_DIR).toBeUndefined()
    expect(env.ECOS_ELECTRON_OSS_CAD_DIR).toBeUndefined()
  })

  it('leaves development env unchanged even when a source-tree OSS CAD fixture exists', () => {
    const fixture = createRepoFixture()
    const sourceOssCadRoot = join(
      fixture.appPath,
      'resources',
      'resources',
      'oss-cad-suite',
    )
    mkdirSync(join(sourceOssCadRoot, 'bin'), { recursive: true })
    writeFileSync(join(sourceOssCadRoot, 'bin', 'yosys'), '#!/usr/bin/env bash\n')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        PATH: '/usr/bin',
      },
      isPackaged: false,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('ignores ECOS_ELECTRON_OSS_CAD_DIR as a packaged fallback', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const customOssCadRoot = join(fixture.repoRoot, 'custom-oss-cad-suite')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    mkdirSync(join(customOssCadRoot, 'bin'), { recursive: true })
    writeFileSync(join(resourcesPath, 'binaries', 'ecc'), '#!/usr/bin/env bash\n')
    writeFileSync(join(customOssCadRoot, 'bin', 'yosys'), '#!/usr/bin/env bash\n')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ELECTRON_OSS_CAD_DIR: customOssCadRoot,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env.CHIPCOMPILER_OSS_CAD_DIR).toBeUndefined()
    expect(env.ECOS_ELECTRON_OSS_CAD_DIR).toBeUndefined()
  })

  it('does not preserve ECOS_ELECTRON_OSS_CAD_DIR when it points at an unusable root', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const customOssCadRoot = join(fixture.repoRoot, 'custom-oss-cad-suite')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    mkdirSync(customOssCadRoot, { recursive: true })
    writeFileSync(join(resourcesPath, 'binaries', 'ecc'), '#!/usr/bin/env bash\n')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ELECTRON_OSS_CAD_DIR: customOssCadRoot,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env.CHIPCOMPILER_OSS_CAD_DIR).toBeUndefined()
    expect(env.ECOS_ELECTRON_OSS_CAD_DIR).toBeUndefined()
  })

  it('prepends Windows packaged runtime without injecting packaged OSS CAD', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const ossCadRoot = join(resourcesPath, 'resources', 'oss-cad-suite')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    mkdirSync(join(ossCadRoot, 'bin'), { recursive: true })
    writeFileSync(join(resourcesPath, 'binaries', 'ecc.cmd'), '@echo off\r\n')
    writeFileSync(join(ossCadRoot, 'bin', 'yosys.exe'), '')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        Path: 'C:\\Windows\\System32',
      },
      isPackaged: true,
      platform: 'win32',
      userDataPath: fixture.userDataPath,
    })

    expect(env.Path).toBe(`${join(resourcesPath, 'binaries')};C:\\Windows\\System32`)
    expect(env.CHIPCOMPILER_OSS_CAD_DIR).toBeUndefined()
    expect(env.ECOS_ELECTRON_OSS_CAD_DIR).toBeUndefined()
  })

  it('resolves the packaged ECC executable by absolute path', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const packagedEcc = join(resourcesPath, 'binaries', 'ecc')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    writeFileSync(packagedEcc, '#!/usr/bin/env bash\n')

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/home/ecos/.local/bin:/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(executable).toBe(packagedEcc)
  })

  it('resolves the development ECC shim by absolute path', () => {
    const fixture = createRepoFixture()
    writeFileSync(
      join(fixture.repoRoot, 'ecc', 'pyproject.toml'),
      '[project]\nname = "ecc"\n',
    )
    mkdirSync(join(fixture.repoRoot, 'ecos', 'scripts'), { recursive: true })
    writeFileSync(
      join(fixture.repoRoot, 'ecos', 'scripts', 'ecc-wrapper.sh'),
      '#!/usr/bin/env bash\n',
    )

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        PATH: '/home/ecos/.local/bin:/usr/bin',
      },
      isPackaged: false,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(executable).toBe(join(fixture.userDataPath, 'runtime-bin', 'ecc'))
  })

  it('strips inherited OSS CAD vars in packaged mode without bundled ecc', () => {
    const fixture = createRepoFixture()
    writeFileSync(join(fixture.repoRoot, 'ecc', 'pyproject.toml'), '')

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        CHIPCOMPILER_OSS_CAD_DIR: '/host/oss-cad-suite',
        ECOS_ELECTRON_OSS_CAD_DIR: '/host/electron-oss-cad-suite',
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env).toEqual({ PATH: '/usr/bin' })
  })
})
