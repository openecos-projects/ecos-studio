import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFrontendRpcLaunchResolver } from './frontendRpcRuntime'

const roots: string[] = []

function createFrontendRoot(withCommand = true): string {
  const root = mkdtempSync(join(tmpdir(), 'frontend-rpc-runtime-'))
  roots.push(root)
  mkdirSync(join(root, 'fecompiler'))
  if (withCommand) {
    mkdirSync(join(root, 'bin'))
    writeFileSync(join(root, 'bin', 'ecc-fe'), '#!/bin/sh\n')
  }
  return root
}

describe('createFrontendRpcLaunchResolver', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
  })

  it('prefers the explicitly selected development checkout', () => {
    const root = createFrontendRoot()
    const resolveLaunch = createFrontendRpcLaunchResolver({
      env: { ECOS_FE_DEV_ROOT: root },
    })

    const launch = resolveLaunch({
      ECOS_FE_CLI: '/installed/ecc-fe',
      PATH: '/bin',
    })

    expect(launch.command).toBe(join(root, 'bin', 'ecc-fe'))
    expect(launch.args).toEqual(['rpc', 'serve', '--stdio'])
    expect(launch.env?.ECOS_FE_COMPILER_ROOT).toBe(root)
  })

  it('uses the Resource Manager installed runtime', () => {
    const resolveLaunch = createFrontendRpcLaunchResolver()

    const launch = resolveLaunch({
      ECOS_FE_CLI: '/resources/ecc-fe/bin/ecc-fe',
      ECOS_FE_COMPILER_ROOT: '/resources/ecc-fe',
    })

    expect(launch.command).toBe('/resources/ecc-fe/bin/ecc-fe')
    expect(launch.args).toEqual(['rpc', 'serve', '--stdio'])
  })

  it('runs Python overrides in module mode with an explicit PYTHONPATH', () => {
    const root = createFrontendRoot(false)
    const resolveLaunch = createFrontendRpcLaunchResolver()

    const launch = resolveLaunch({
      ECOS_FE_CLI: 'python3',
      ECOS_FE_COMPILER_ROOT: root,
      PYTHONPATH: '/existing',
    })

    expect(launch.command).toBe('python3')
    expect(launch.args).toEqual(['-m', 'fecompiler.cli.main', 'rpc', 'serve', '--stdio'])
    expect(launch.env?.PYTHONPATH).toContain(root)
    expect(launch.env?.PYTHONPATH).toContain('/existing')
  })
})
