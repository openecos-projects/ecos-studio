import { describe, expect, it } from 'vitest'
import { collectFormatTargets, runStagedFormatter } from './fmt-staged.mjs'

const repoRoot = '/repo'
const guiRoot = '/repo/ecos/gui'

function createStat(existingPaths) {
  return async (path) => {
    if (!existingPaths.has(path)) {
      throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' })
    }

    return {
      isFile: () => true,
    }
  }
}

describe('collectFormatTargets', () => {
  it('normalizes staged GUI files and skips unsupported, missing, and outside paths', async () => {
    const targets = await collectFormatTargets(
      [
        'ecos/gui/apps/renderer/src/App.vue',
        'package.json',
        '/repo/ecos/gui/scripts/fmt-staged.mjs',
        'ecos/gui/README.md',
        'ecos/gui/apps/renderer/src/assets/logo.png',
        'ecos/gui/missing.ts',
        'README.md',
        'ecos/ecc/foo.ts',
        '/repo/ecc/foo.ts',
        'ecos/gui/apps/renderer/src/App.vue',
      ],
      {
        guiRoot,
        repoRoot,
        stat: createStat(
          new Set([
            '/repo/ecos/gui/apps/renderer/src/App.vue',
            '/repo/ecos/gui/package.json',
            '/repo/ecos/gui/scripts/fmt-staged.mjs',
            '/repo/ecos/gui/README.md',
          ]),
        ),
      },
    )

    expect(targets).toEqual([
      'apps/renderer/src/App.vue',
      'package.json',
      'scripts/fmt-staged.mjs',
      'README.md',
    ])
  })
})

describe('runStagedFormatter', () => {
  it('does not invoke oxfmt when no staged file can be formatted', async () => {
    let spawnCalled = false

    const exitCode = await runStagedFormatter(['ecos/gui/assets/logo.png'], {
      guiRoot,
      repoRoot,
      log: () => {},
      spawn: async () => {
        spawnCalled = true
        return 1
      },
      stat: createStat(new Set()),
    })

    expect(exitCode).toBe(0)
    expect(spawnCalled).toBe(false)
  })

  it('runs oxfmt check with GUI-relative staged files', async () => {
    const calls = []

    const exitCode = await runStagedFormatter(['ecos/gui/package.json'], {
      guiRoot,
      repoRoot,
      log: () => {},
      spawn: async (command, args, options) => {
        calls.push({ args, command, options })
        return 0
      },
      stat: createStat(new Set(['/repo/ecos/gui/package.json'])),
    })

    expect(exitCode).toBe(0)
    expect(calls).toEqual([
      {
        args: ['--check', 'package.json'],
        command: 'oxfmt',
        options: {
          cwd: guiRoot,
          stdio: 'inherit',
        },
      },
    ])
  })
})
