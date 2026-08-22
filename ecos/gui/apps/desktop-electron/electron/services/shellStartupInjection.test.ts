import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runtimeBinPathEnvVariable, userZdotdirEnvVariable } from './eccRpc/runtimeEnv'
import { ensureShellStartupFiles, planShellStartup } from './shellStartupInjection'

const tempDirs: string[] = []

function makeStartupDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ecos-shell-startup-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { force: true, recursive: true })
  }
})

describe('ensureShellStartupFiles', () => {
  it('creates zsh and bash startup files that preserve user rc files and merge the runtime bin path', () => {
    const startupDir = makeStartupDir()

    ensureShellStartupFiles(startupDir)

    const zshenv = readFileSync(join(startupDir, 'zsh', '.zshenv'), 'utf8')
    const zshrc = readFileSync(join(startupDir, 'zsh', '.zshrc'), 'utf8')
    const bashRc = readFileSync(join(startupDir, 'bash', 'rc'), 'utf8')

    expect(zshenv).toContain(userZdotdirEnvVariable)
    expect(zshenv).toContain('[[ ! -o rcs ]]')
    expect(zshenv).toContain('*readonly*')
    expect(zshenv).toContain('typeset +x ECOS_USER_ZDOTDIR')
    expect(zshenv).toContain('_ecos_merge_terminal_path()')
    expect(zshenv).toContain(`\${(@s.:.)${runtimeBinPathEnvVariable}}`)
    expect(zshenv).toContain('${(@u)path}')
    expect(zshenv).toContain('${ZDOTDIR-$HOME}')
    expect(zshrc).toContain(userZdotdirEnvVariable)
    expect(zshrc).toContain('*readonly*')
    expect(zshrc).toContain('ZDOTDIR="$ECOS_USER_ZDOTDIR"')
    expect(zshrc).toContain('_ecos_merge_terminal_path')
    expect(zshrc).toContain('${ZDOTDIR-$HOME}')
    expect(bashRc).toContain('$HOME/.bashrc')
    expect(bashRc).toContain(runtimeBinPathEnvVariable)
    expect(bashRc).toContain('${PATH+x}')
  })

  it('leaves up-to-date files untouched and rewrites stale content', () => {
    const startupDir = makeStartupDir()
    ensureShellStartupFiles(startupDir)
    const zshrcPath = join(startupDir, 'zsh', '.zshrc')
    const freshContent = readFileSync(zshrcPath, 'utf8')
    const freshMtime = statSync(zshrcPath).mtimeMs

    ensureShellStartupFiles(startupDir)
    expect(statSync(zshrcPath).mtimeMs).toBe(freshMtime)

    writeFileSync(zshrcPath, '# stale user edit\n')
    ensureShellStartupFiles(startupDir)
    expect(readFileSync(zshrcPath, 'utf8')).toBe(freshContent)
  })
})

describe('planShellStartup', () => {
  it('injects ZDOTDIR for zsh without changing args when the runtime bin marker is set', () => {
    const plan = planShellStartup({
      shell: '/run/current-system/sw/bin/zsh',
      env: { PATH: '/runtime/bin:/usr/bin', [runtimeBinPathEnvVariable]: '/runtime/bin' },
      platform: 'linux',
      startupDir: '/data/shell-rc',
    })

    expect(plan).toEqual({
      args: [],
      env: {
        ZDOTDIR: '/data/shell-rc/zsh',
      },
    })
  })

  it('preserves an inherited custom ZDOTDIR for the zsh wrapper', () => {
    const plan = planShellStartup({
      shell: '/usr/bin/zsh',
      env: {
        PATH: '/runtime/bin',
        ZDOTDIR: '/home/ecos/.config/zsh',
        [runtimeBinPathEnvVariable]: '/runtime/bin',
      },
      platform: 'linux',
      startupDir: '/data/shell-rc',
    })

    expect(plan).toEqual({
      args: [],
      env: {
        ZDOTDIR: '/data/shell-rc/zsh',
        [userZdotdirEnvVariable]: '/home/ecos/.config/zsh',
      },
    })
  })

  it('treats an inherited empty ZDOTDIR as explicitly set', () => {
    const plan = planShellStartup({
      shell: '/usr/bin/zsh',
      env: { ZDOTDIR: '', [runtimeBinPathEnvVariable]: '/runtime/bin' },
      platform: 'linux',
      startupDir: '/data/shell-rc',
    })

    expect(plan.env[userZdotdirEnvVariable]).toBe('')
  })

  it('injects --rcfile for bash without touching the env', () => {
    const plan = planShellStartup({
      shell: '/usr/bin/bash',
      env: {
        PATH: '/runtime/bin:/usr/bin',
        [runtimeBinPathEnvVariable]: '/runtime/bin',
      },
      platform: 'linux',
      startupDir: '/data/shell-rc',
    })

    expect(plan).toEqual({
      args: ['--rcfile', '/data/shell-rc/bash/rc'],
      env: {},
    })
  })

  it('returns a no-op plan when the runtime bin marker is missing or empty', () => {
    for (const env of [
      { PATH: '/runtime/bin:/usr/bin' },
      { PATH: '/runtime/bin', [runtimeBinPathEnvVariable]: '' },
    ]) {
      expect(
        planShellStartup({
          shell: '/bin/zsh',
          env,
          platform: 'linux',
          startupDir: '/data/shell-rc',
        }),
      ).toEqual({ args: [], env: {} })
    }
  })

  it('returns a no-op plan for other shells', () => {
    for (const shell of ['/bin/fish', '/bin/sh', '/usr/bin/nu']) {
      expect(
        planShellStartup({
          shell,
          env: { [runtimeBinPathEnvVariable]: '/runtime/bin' },
          platform: 'linux',
          startupDir: '/data/shell-rc',
        }),
      ).toEqual({ args: [], env: {} })
    }
  })

  it('returns a no-op plan on Windows', () => {
    expect(
      planShellStartup({
        shell: 'zsh',
        env: { [runtimeBinPathEnvVariable]: 'C:\\runtime\\bin' },
        platform: 'win32',
        startupDir: 'C:\\shell-rc',
      }),
    ).toEqual({ args: [], env: {} })
  })
})
