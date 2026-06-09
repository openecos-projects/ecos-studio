import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEccCliRuntimeEnv } from './eccCliRuntime'

function createRepoFixture(): { appPath: string; repoRoot: string; userDataPath: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ecos-studio-'))
  const appPath = join(repoRoot, 'ecos', 'gui', 'apps', 'desktop-electron')
  const userDataPath = join(repoRoot, 'user-data')

  mkdirSync(join(repoRoot, 'ecc'), { recursive: true })
  mkdirSync(appPath, { recursive: true })
  mkdirSync(userDataPath, { recursive: true })

  return { appPath, repoRoot, userDataPath }
}

describe('createEccCliRuntimeEnv', () => {
  it('leaves development env unchanged so global ecc from PATH is used', () => {
    const fixture = createRepoFixture()
    mkdirSync(join(fixture.repoRoot, 'ecc'), { recursive: true })
    const pyprojectPath = join(fixture.repoRoot, 'ecc', 'pyproject.toml')
    writeFileSync(pyprojectPath, '[project]\nname = "ecc"\n')
    const venvBin = join(fixture.repoRoot, 'ecc', '.venv', 'bin')
    const venvEcc = join(venvBin, 'ecc')
    mkdirSync(venvBin, { recursive: true })
    writeFileSync(venvEcc, '#!/usr/bin/env bash\n')

    const env = createEccCliRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        HOME: '/home/ecos',
        PATH: '/usr/bin',
      },
      isPackaged: false,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    const wrapperPath = join(fixture.userDataPath, 'runtime-bin', 'ecc')

    expect(env).toEqual({
      HOME: '/home/ecos',
      PATH: '/usr/bin',
    })
    expect(existsSync(wrapperPath)).toBe(false)
  })

  it('does not create a POSIX development wrapper when local ecc exists without a venv binary', () => {
    const fixture = createRepoFixture()
    mkdirSync(join(fixture.repoRoot, 'ecc'), { recursive: true })
    const pyprojectPath = join(fixture.repoRoot, 'ecc', 'pyproject.toml')
    writeFileSync(pyprojectPath, '[project]\nname = "ecc"\n')

    const env = createEccCliRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        HOME: '/home/ecos',
        PATH: '/usr/bin',
      },
      isPackaged: false,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    const wrapperPath = join(fixture.userDataPath, 'runtime-bin', 'ecc')

    expect(env).toEqual({
      HOME: '/home/ecos',
      PATH: '/usr/bin',
    })
    expect(existsSync(wrapperPath)).toBe(false)
  })

  it('leaves Windows development env unchanged', () => {
    const fixture = createRepoFixture()
    writeFileSync(join(fixture.repoRoot, 'ecc', 'pyproject.toml'), '')

    const env = createEccCliRuntimeEnv({
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

  it('does not prepend Windows development venv binaries', () => {
    const fixture = createRepoFixture()
    writeFileSync(join(fixture.repoRoot, 'ecc', 'pyproject.toml'), '')
    const venvScripts = join(fixture.repoRoot, 'ecc', '.venv', 'Scripts')
    mkdirSync(venvScripts, { recursive: true })
    writeFileSync(join(venvScripts, 'ecc.exe'), '')

    const env = createEccCliRuntimeEnv({
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

    const env = createEccCliRuntimeEnv({
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

    const env = createEccCliRuntimeEnv({
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

    const env = createEccCliRuntimeEnv({
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

  it('does not inject bundled OSS CAD env when packaged resources include yosys', () => {
    const fixture = createRepoFixture()
    const resourcesPath = join(fixture.repoRoot, 'packaged-resources')
    const ossCadRoot = join(resourcesPath, 'resources', 'oss-cad-suite')
    mkdirSync(join(resourcesPath, 'binaries'), { recursive: true })
    mkdirSync(join(ossCadRoot, 'bin'), { recursive: true })
    writeFileSync(join(resourcesPath, 'binaries', 'ecc'), '#!/usr/bin/env bash\n')
    writeFileSync(join(ossCadRoot, 'bin', 'yosys'), '#!/usr/bin/env bash\n')

    const env = createEccCliRuntimeEnv({
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

    const env = createEccCliRuntimeEnv({
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

    const env = createEccCliRuntimeEnv({
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

    const env = createEccCliRuntimeEnv({
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

    const env = createEccCliRuntimeEnv({
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

    const env = createEccCliRuntimeEnv({
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

    const env = createEccCliRuntimeEnv({
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

  it('strips inherited OSS CAD vars in packaged mode without bundled ecc', () => {
    const fixture = createRepoFixture()
    writeFileSync(join(fixture.repoRoot, 'ecc', 'pyproject.toml'), '')

    const env = createEccCliRuntimeEnv({
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
