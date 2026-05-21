import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEccCliRuntimeEnv, createDevEccCliRuntimeEnv } from './eccCliRuntime'

function createRepoFixture(): { appPath: string; repoRoot: string; userDataPath: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ecos-studio-'))
  const appPath = join(repoRoot, 'ecos', 'gui', 'apps', 'desktop-electron')
  const userDataPath = join(repoRoot, 'user-data')

  mkdirSync(join(repoRoot, 'ecc'), { recursive: true })
  mkdirSync(appPath, { recursive: true })
  mkdirSync(userDataPath, { recursive: true })

  return { appPath, repoRoot, userDataPath }
}

describe('createDevEccCliRuntimeEnv', () => {
  it('leaves development env unchanged so global ecc from PATH is used', () => {
    const fixture = createRepoFixture()
    mkdirSync(join(fixture.repoRoot, 'ecc'), { recursive: true })
    const pyprojectPath = join(fixture.repoRoot, 'ecc', 'pyproject.toml')
    writeFileSync(pyprojectPath, '[project]\nname = "ecc"\n')
    const venvBin = join(fixture.repoRoot, 'ecc', '.venv', 'bin')
    const venvEcc = join(venvBin, 'ecc')
    mkdirSync(venvBin, { recursive: true })
    writeFileSync(venvEcc, '#!/usr/bin/env bash\n')

    const env = createDevEccCliRuntimeEnv({
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

    const env = createDevEccCliRuntimeEnv({
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

    const env = createDevEccCliRuntimeEnv({
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

    const env = createDevEccCliRuntimeEnv({
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

    const env = createDevEccCliRuntimeEnv({
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

    const env = createDevEccCliRuntimeEnv({
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

  it('does not inject the development wrapper in packaged mode without bundled ecc', () => {
    const fixture = createRepoFixture()
    writeFileSync(join(fixture.repoRoot, 'ecc', 'pyproject.toml'), '')

    const env = createDevEccCliRuntimeEnv({
      appPath: fixture.appPath,
      cwd: fixture.appPath,
      env: {
        PATH: '/usr/bin',
      },
      isPackaged: true,
      platform: 'linux',
      userDataPath: fixture.userDataPath,
    })

    expect(env).toEqual({ PATH: '/usr/bin' })
  })
})
