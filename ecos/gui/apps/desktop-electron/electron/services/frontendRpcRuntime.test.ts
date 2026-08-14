import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createFrontendRpcLaunchResolver,
  frontendRuntimeEventFromNotification,
  normalizeFrontendRuntimeEvent,
} from './frontendRpcRuntime'

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

describe('frontendRuntimeEventFromNotification', () => {
  it('preserves completed step report metadata from ecc-fe notifications', () => {
    expect(
      frontendRuntimeEventFromNotification('runtime.event', {
        cmd: 'rtl2gds',
        data: {
          directory: '/work/frontend',
          home_page: '/work/frontend/home/home.json',
          log_file: '/work/frontend/prepare/log.txt',
          state: 'Success',
          step: 'prepare',
          subflow_path: '/work/frontend/prepare/subflow.json',
          workspaceId: 'workspace-frontend-1',
        },
        message: ['frontend step prepare Success'],
        phase: 'stdout',
        type: 'event',
      }),
    ).toEqual({
      data: {
        directory: '/work/frontend',
        home_page: '/work/frontend/home/home.json',
        log_file: '/work/frontend/prepare/log.txt',
        state: 'Success',
        step: 'prepare',
        subflow_path: '/work/frontend/prepare/subflow.json',
        workspaceId: 'workspace-frontend-1',
      },
      message: 'frontend step prepare Success',
      method: 'flow.run',
      phase: 'stdout',
      step: 'prepare',
      type: 'operation.progress',
      workspaceDirectory: '/work/frontend',
    })
  })

  it('normalizes ecc-fe subflow stages for the shared renderer contract', () => {
    expect(
      frontendRuntimeEventFromNotification('runtime.event', {
        cmd: 'run_step',
        data: {
          directory: '/work/frontend',
          peak_memory_mb: 12.5,
          runtime: '0:0:1',
          state: 'Success',
          step: 'prepare',
          subflow_step: 'collect inputs',
          tool: 'fe',
          workspaceId: 'workspace-frontend-1',
        },
        phase: 'subflow.stage',
        type: 'event',
      }),
    ).toEqual({
      data: {
        directory: '/work/frontend',
        peak_memory_mb: 12.5,
        runtime: '0:0:1',
        runtimeProtocolType: 'subflow.stage',
        state: 'Success',
        step: 'prepare',
        subflowPeakMemory: 12.5,
        subflowRuntime: '0:0:1',
        subflowStep: 'collect inputs',
        subflow_step: 'collect inputs',
        tool: 'fe',
        workspaceId: 'workspace-frontend-1',
      },
      message: undefined,
      method: 'flow.run_step',
      phase: 'subflow.stage',
      step: 'prepare',
      type: 'operation.progress',
      workspaceDirectory: '/work/frontend',
    })
  })

  it('ignores unrelated JSON-RPC notifications', () => {
    expect(frontendRuntimeEventFromNotification('rpc.log', {})).toBeNull()
  })
})

describe('normalizeFrontendRuntimeEvent', () => {
  it('converts frontend parent step boundaries into standard protocol events', () => {
    const normalized = normalizeFrontendRuntimeEvent({
      data: {
        directory: '/work/frontend',
        log_file: '/work/frontend/prepare/log.txt',
        state: 'Success',
        step: 'prepare',
        tool: 'fe',
      },
      method: 'flow.run',
      operationId: 'frontend-op-1',
      phase: 'completed',
      step: 'prepare',
      type: 'operation.progress',
      workspaceDirectory: '/work/frontend',
      workspaceHandle: 'workspace-frontend-1',
    })

    expect(normalized.type).toBe('runtime.protocol')
    if (normalized.type !== 'runtime.protocol') return
    expect(normalized.event).toMatchObject({
      kind: 'flow',
      operationId: 'frontend-op-1',
      origin: 'gui',
      type: 'step.completed',
      workspaceId: 'workspace-frontend-1',
    })
    expect(normalized.event.payload).toMatchObject({
      state: 'Success',
      step: 'prepare',
      tool: 'fe',
    })
  })

  it('converts frontend subflow stages into the standard protocol shape', () => {
    const normalized = normalizeFrontendRuntimeEvent({
      data: {
        peak_memory_mb: 12.5,
        runtime: '0:0:1',
        state: 'Success',
        step: 'prepare',
        subflow_step: 'collect inputs',
      },
      method: 'flow.run',
      operationId: 'frontend-op-2',
      phase: 'subflow.stage',
      step: 'prepare',
      type: 'operation.progress',
      workspaceDirectory: '/work/frontend',
      workspaceHandle: 'workspace-frontend-1',
    })

    expect(normalized.type).toBe('runtime.protocol')
    if (normalized.type !== 'runtime.protocol') return
    expect(normalized.event).toMatchObject({
      kind: 'flow',
      operationId: 'frontend-op-2',
      type: 'subflow.stage',
    })
    expect(normalized.event.payload).toMatchObject({
      state: 'Success',
      step: 'prepare',
      subflowPeakMemory: 12.5,
      subflowRuntime: '0:0:1',
      subflowStep: 'collect inputs',
    })
  })

  it('leaves progress unmodified until the runtime has an operation identity', () => {
    const event = {
      data: { step: 'prepare' },
      method: 'flow.run',
      phase: 'started',
      step: 'prepare',
      type: 'operation.progress' as const,
    }
    expect(normalizeFrontendRuntimeEvent(event)).toBe(event)
  })
})
