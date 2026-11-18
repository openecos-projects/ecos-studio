import { EventEmitter } from 'node:events'
import { access, writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { ChipViewerService } from './chipViewerService'

vi.mock('./replayService', () => ({
  buildReplayCatalog: vi.fn(async () => '/workspace/replay/catalog.json'),
}))

const children: EventEmitter[] = []
afterEach(() => {
  children.splice(0).forEach((child) => child.emit('exit', 0, null))
})

function createService(fail = false) {
  const child = Object.assign(new EventEmitter(), { pid: 123, unref: vi.fn() })
  children.push(child)
  const spawnProcess = vi.fn((_file: string, _args: string[]) => {
    if (fail) throw new Error('Native launch failed')
    return child
  })
  const service = new ChipViewerService({
    appPath: '/repo/ecos/gui/apps/desktop-electron',
    cwd: '/repo',
    isPackaged: false,
    env: { DISPLAY: ':99' },
    fileExists: () => true,
    ensureDirectory: async () => undefined,
    openLogFile: () => 11,
    closeLogFile: () => undefined,
    readTextFile: async () => '',
    spawnProcess,
    viewerStartupCheckMs: 0,
    workspaceResourceService: { resolveStepInfo: vi.fn() },
  })
  return { service, child, spawnProcess }
}

const request = { projectPath: '/workspace', step: 'replay', mode: 'replay' as const }
const progress = {
  state: 'loading',
  phase: 'Finding layout changes',
  name: 'place',
  step: 3,
  steps: 22,
  frame: 5,
  frames: 67,
}

it('passes an isolated progress file to native and returns progress through isOpen until exit', async () => {
  const { service, child, spawnProcess } = createService()
  await service.open(request)
  const args = spawnProcess.mock.calls[0][1]
  const path = args[args.indexOf('--replay-progress-file') + 1]
  expect(path).toContain('ecos-replay-')
  expect(path).not.toContain(request.projectPath)
  await writeFile(path, JSON.stringify(progress))
  expect(await service.isOpen(request)).toEqual({ open: true, replayLoading: progress })
  expect(await service.isOpen({ ...request, projectPath: '/other' })).toEqual({
    open: false,
  })
  await writeFile(path, JSON.stringify({ ...progress, state: 'ready' }))
  expect((await service.isOpen(request)).replayLoading?.state).toBe('ready')
  child.emit('exit', 0, null)
  expect(await service.isOpen(request)).toEqual({ open: false })
  await vi.waitFor(async () => {
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

it('cleans up progress and open state when launch fails', async () => {
  const { service, spawnProcess } = createService(true)
  await expect(service.open(request)).rejects.toThrow('Native launch failed')
  expect(await service.isOpen(request)).toEqual({ open: false })
  const args = spawnProcess.mock.calls[0][1]
  const path = args[args.indexOf('--replay-progress-file') + 1]
  await vi.waitFor(async () => {
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
