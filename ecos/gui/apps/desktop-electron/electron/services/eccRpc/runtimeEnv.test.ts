import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEccRuntimeEnv, resolveDataHome, resolveEccExecutable } from './runtimeEnv'

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
      // Hermetic: the host must not contribute a real bundle home.
      dataHome: join(fixture.repoRoot, 'empty-data-home'),
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
      // Hermetic: the host must not contribute a real bundle home.
      dataHome: join(fixture.repoRoot, 'empty-data-home'),
    })

    expect(env).toEqual({ PATH: '/usr/bin' })
  })
})

describe('bundle home resolution', () => {
  function createBundleHome(userDataParent: string): {
    dataHome: string
    binariesDir: string
  } {
    const dataHome = join(userDataParent, 'data-home')
    const binariesDir = join(
      dataHome,
      'ecos-studio',
      'ecc-runtime',
      'current',
      'binaries',
    )
    mkdirSync(join(binariesDir, '_internal', 'ecc_tools_bin', 'lib'), {
      recursive: true,
    })
    writeFileSync(join(binariesDir, 'ecc'), '#!/usr/bin/env bash\n')
    return { dataHome, binariesDir }
  }

  it('falls back to the bundle home when packaged binaries are absent', () => {
    const fixture = createRepoFixture()
    const { dataHome, binariesDir } = createBundleHome(fixture.repoRoot)

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: { PATH: '/usr/bin' },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome,
    })

    expect(executable).toBe(join(binariesDir, 'ecc'))
  })

  it('prefers packaged binaries over the bundle home', () => {
    const fixture = createRepoFixture()
    const { dataHome } = createBundleHome(fixture.repoRoot)
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const packagedEcc = join(resourcesPath, 'binaries', 'ecc')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    writeFileSync(packagedEcc, '#!/usr/bin/env bash\n')

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: { ECOS_ELECTRON_RESOURCES_PATH: resourcesPath, PATH: '/usr/bin' },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome,
    })

    expect(executable).toBe(packagedEcc)
  })

  it('returns null when neither packaged nor bundle-home binaries exist', () => {
    const fixture = createRepoFixture()

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: { PATH: '/usr/bin' },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome: join(fixture.repoRoot, 'empty-data-home'),
    })

    expect(executable).toBeNull()
  })

  it('prepends the bundle home to PATH and LD_LIBRARY_PATH', () => {
    const fixture = createRepoFixture()
    const { dataHome, binariesDir } = createBundleHome(fixture.repoRoot)

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        CHIPCOMPILER_OSS_CAD_DIR: '/host/oss-cad-suite',
        LD_LIBRARY_PATH: '/existing/libs',
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome,
    })

    expect(env.PATH).toBe(`${binariesDir}:/usr/bin`)
    expect(env.LD_LIBRARY_PATH).toBe(
      `${join(binariesDir, '_internal', 'ecc_tools_bin', 'lib')}:/existing/libs`,
    )
    expect(env.CHIPCOMPILER_OSS_CAD_DIR).toBeUndefined()
  })
})

describe('bundle home symlink containment', () => {
  it('ignores a current symlink that resolves outside the bundle home', () => {
    const fixture = createRepoFixture()
    const dataHome = join(fixture.repoRoot, 'data-home')
    const homeRoot = join(dataHome, 'ecos-studio', 'ecc-runtime')
    const current = join(homeRoot, 'current')
    mkdirSync(current, { recursive: true })
    // current -> inside-link -> outside
    const insideLink = join(homeRoot, 'inside-link')
    const outside = join(fixture.repoRoot, 'outside')
    mkdirSync(join(outside, 'binaries'), { recursive: true })
    writeFileSync(join(outside, 'binaries', 'ecc'), '#!/bin/sh\n')
    symlinkSync(outside, insideLink)
    rmSync(current, { recursive: true })
    symlinkSync(insideLink, current)

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: { PATH: '/usr/bin' },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome,
    })

    expect(executable).toBeNull()
  })
})

describe('external ECC override', () => {
  function createExternalEccDir(parent: string): string {
    const binDir = join(parent, 'external-ecc')
    mkdirSync(join(binDir, '_internal', 'ecc_tools_bin', 'lib'), { recursive: true })
    const executablePath = join(binDir, 'ecc')
    writeFileSync(executablePath, '#!/bin/sh\necho external-ecc\n')
    chmodSync(executablePath, 0o755)
    return binDir
  }

  function createPackagedEcc(repoRoot: string): string {
    const resourcesPath = join(repoRoot, 'packaged-resources')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    writeFileSync(join(resourcesPath, 'binaries', 'ecc'), '#!/bin/sh\n')
    return resourcesPath
  }

  it('prefers the ECOS_ECC_BIN_DIR override over packaged binaries', () => {
    const fixture = createRepoFixture()
    const externalBin = createExternalEccDir(fixture.repoRoot)
    const resourcesPath = createPackagedEcc(fixture.repoRoot)

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ECC_BIN_DIR: externalBin,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome: join(fixture.repoRoot, 'empty-data-home'),
    })

    expect(executable).toBe(join(externalBin, 'ecc'))
  })

  it('prefers the explicit option over the environment variable', () => {
    const fixture = createRepoFixture()
    const externalBin = createExternalEccDir(fixture.repoRoot)

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: { ECOS_ECC_BIN_DIR: '/nonexistent', PATH: '/usr/bin' },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome: join(fixture.repoRoot, 'empty-data-home'),
      externalEccBinDir: externalBin,
    })

    expect(executable).toBe(join(externalBin, 'ecc'))
  })

  it('disables the override entirely when the explicit option is set but invalid', () => {
    const fixture = createRepoFixture()
    const externalBin = createExternalEccDir(fixture.repoRoot)
    const resourcesPath = createPackagedEcc(fixture.repoRoot)

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ECC_BIN_DIR: externalBin,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome: join(fixture.repoRoot, 'empty-data-home'),
      externalEccBinDir: join(fixture.repoRoot, 'missing-ecc'),
    })

    // No env fallback: an invalid explicit value means no override at all.
    expect(executable).toBe(join(resourcesPath, 'binaries', 'ecc'))
  })

  it('ignores a relative override path', () => {
    const fixture = createRepoFixture()
    const resourcesPath = createPackagedEcc(fixture.repoRoot)

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ECC_BIN_DIR: 'relative/external-ecc',
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome: join(fixture.repoRoot, 'empty-data-home'),
    })

    expect(executable).toBe(join(resourcesPath, 'binaries', 'ecc'))
  })

  it('ignores an override without an executable ecc', () => {
    const fixture = createRepoFixture()
    const resourcesPath = createPackagedEcc(fixture.repoRoot)
    const emptyExternal = join(fixture.repoRoot, 'external-without-ecc')
    mkdirSync(emptyExternal, { recursive: true })

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ECC_BIN_DIR: emptyExternal,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome: join(fixture.repoRoot, 'empty-data-home'),
    })

    expect(executable).toBe(join(resourcesPath, 'binaries', 'ecc'))
  })

  it('ignores an override whose ecc entry is a directory', () => {
    const fixture = createRepoFixture()
    const resourcesPath = createPackagedEcc(fixture.repoRoot)
    // A searchable directory passes accessSync(X_OK) on POSIX but cannot be
    // spawned, so it must not count as an executable override.
    const externalBin = join(fixture.repoRoot, 'external-ecc')
    mkdirSync(join(externalBin, 'ecc'), { recursive: true })

    const executable = resolveEccExecutable({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ECC_BIN_DIR: externalBin,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome: join(fixture.repoRoot, 'empty-data-home'),
    })

    expect(executable).toBe(join(resourcesPath, 'binaries', 'ecc'))
  })

  it('applies the override in development mode', () => {
    const fixture = createRepoFixture()
    writeFileSync(
      join(fixture.repoRoot, 'ecc', 'pyproject.toml'),
      '[project]\nname = "ecc"\n',
    )
    const wrapperDir = join(fixture.repoRoot, 'ecos', 'scripts')
    mkdirSync(wrapperDir, { recursive: true })
    writeFileSync(join(wrapperDir, 'ecc-wrapper.sh'), '#!/usr/bin/env bash\n')
    const externalBin = createExternalEccDir(fixture.repoRoot)

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ECC_BIN_DIR: externalBin,
        LD_LIBRARY_PATH: '/existing/libs',
        PATH: '/usr/bin',
      },
      isPackaged: false,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env.PATH).toBe(`${externalBin}:/usr/bin`)
    // The external bundle's native libraries resolve in development mode too.
    expect(env.LD_LIBRARY_PATH).toBe(
      `${join(externalBin, '_internal', 'ecc_tools_bin', 'lib')}:/existing/libs`,
    )
    // The development runtime-bin shim is not materialized.
    expect(existsSync(join(fixture.userDataPath, 'runtime-bin', 'ecc'))).toBe(false)
  })

  it('derives PATH and LD_LIBRARY_PATH from the external bin directory', () => {
    const fixture = createRepoFixture()
    const externalBin = createExternalEccDir(fixture.repoRoot)

    const env = createEccRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        ECOS_ECC_BIN_DIR: externalBin,
        LD_LIBRARY_PATH: '/existing/libs',
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
      dataHome: join(fixture.repoRoot, 'empty-data-home'),
    })

    expect(env.PATH).toBe(`${externalBin}:/usr/bin`)
    expect(env.LD_LIBRARY_PATH).toBe(
      `${join(externalBin, '_internal', 'ecc_tools_bin', 'lib')}:/existing/libs`,
    )
  })
})

describe('resolveDataHome', () => {
  it('treats an empty XDG_DATA_HOME as unset', () => {
    expect(
      resolveDataHome({
        appPath: '/app',
        cwd: '/app',
        env: { XDG_DATA_HOME: '' },
        isPackaged: true,
        platform: 'linux',
        userDataPath: '/user-data',
      }),
    ).toBe(join(homedir(), '.local', 'share'))
  })

  it('prefers the explicit dataHome option', () => {
    expect(
      resolveDataHome({
        appPath: '/app',
        cwd: '/app',
        env: { XDG_DATA_HOME: '/env-data' },
        isPackaged: true,
        platform: 'linux',
        userDataPath: '/user-data',
        dataHome: '/option-data',
      }),
    ).toBe('/option-data')
  })
})
