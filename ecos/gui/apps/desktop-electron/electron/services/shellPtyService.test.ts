import { describe, expect, it, vi } from 'vitest'
import { electronLogger } from './logger'
import { ShellPtyService } from './shellPtyService'

interface FakePtyEventDisposable {
  dispose(): void
}

class FakePty {
  readonly pid = 4242
  readonly write = vi.fn()
  readonly resize = vi.fn()
  readonly kill = vi.fn()
  private dataListener: ((data: string) => void) | null = null
  private exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null

  onData(listener: (data: string) => void): FakePtyEventDisposable {
    this.dataListener = listener
    return { dispose: vi.fn() }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): FakePtyEventDisposable {
    this.exitListener = listener
    return { dispose: vi.fn() }
  }

  emitData(data: string): void {
    this.dataListener?.(data)
  }

  emitExit(event: { exitCode: number; signal?: number }): void {
    this.exitListener?.(event)
  }
}

describe('ShellPtyService', () => {
  it('spawns the user shell and forwards data and exit events with the session id', async () => {
    const fakePty = new FakePty()
    const ptyBackend = {
      spawn: vi.fn(() => fakePty),
    }
    const listener = vi.fn()
    const service = new ShellPtyService({
      env: {
        HOME: '/home/ecos',
        SHELL: '/bin/zsh',
      },
      platform: 'linux',
      ptyBackend,
    })

    const session = await service.createSession({ cols: 120, rows: 32 }, listener)
    fakePty.emitData('hello\r\n')
    fakePty.emitExit({ exitCode: 0 })

    expect(session).toEqual({
      pid: 4242,
      sessionId: expect.any(String),
      shell: '/bin/zsh',
    })
    expect(ptyBackend.spawn).toHaveBeenCalledWith('/bin/zsh', [], expect.objectContaining({
      cols: 120,
      cwd: '/home/ecos',
      env: expect.objectContaining({
        HOME: '/home/ecos',
        SHELL: '/bin/zsh',
        TERM: 'xterm-256color',
      }),
      name: 'xterm-256color',
      rows: 32,
    }))
    expect(listener).toHaveBeenNthCalledWith(1, {
      data: 'hello\r\n',
      sessionId: session.sessionId,
    })
    expect(listener).toHaveBeenNthCalledWith(2, {
      exitCode: 0,
      sessionId: session.sessionId,
    })
  })

  it('delegates writes, resizes, and kills to the active pty session', async () => {
    const fakePty = new FakePty()
    const service = new ShellPtyService({
      env: {
        HOME: '/home/ecos',
        SHELL: '/bin/bash',
      },
      platform: 'linux',
      ptyBackend: {
        spawn: vi.fn(() => fakePty),
      },
    })
    const session = await service.createSession({ cols: 80, rows: 24 }, vi.fn())

    service.write(session.sessionId, 'pwd\r')
    service.resize(session.sessionId, 100, 28)
    service.kill(session.sessionId)

    expect(fakePty.write).toHaveBeenCalledWith('pwd\r')
    expect(fakePty.resize).toHaveBeenCalledWith(100, 28)
    expect(fakePty.kill).toHaveBeenCalledTimes(1)
  })

  it('does not mutate shell prompt hooks for command status decorations', async () => {
    const fakePty = new FakePty()
    const ptyBackend = {
      spawn: vi.fn(() => fakePty),
    }
    const service = new ShellPtyService({
      env: {
        HOME: '/home/ecos',
        PROMPT_COMMAND: 'history -a',
        SHELL: '/bin/bash',
      },
      platform: 'linux',
      ptyBackend,
    })

    await service.createSession({ cols: 80, rows: 24 }, vi.fn())

    expect(ptyBackend.spawn).toHaveBeenCalledWith('/bin/bash', [], expect.objectContaining({
      env: expect.objectContaining({
        PROMPT_COMMAND: 'history -a',
      }),
    }))
  })

  it('resolves envProvider for each new session and uses it for shell, cwd, and spawn env', async () => {
    const firstPty = new FakePty()
    const secondPty = new FakePty()
    const ptyBackend = {
      spawn: vi.fn()
        .mockReturnValueOnce(firstPty)
        .mockReturnValueOnce(secondPty),
    }
    const envProvider = vi.fn()
      .mockResolvedValueOnce({
        HOME: '/home/first',
        PATH: '/dynamic/first/bin',
        SHELL: '/bin/zsh',
      })
      .mockResolvedValueOnce({
        HOME: '/home/second',
        PATH: '/dynamic/second/bin',
        SHELL: '/bin/fish',
      })
    const service = new ShellPtyService({
      env: {
        HOME: '/home/static',
        PATH: '/static/bin',
        SHELL: '/bin/bash',
      },
      envProvider,
      platform: 'linux',
      ptyBackend,
    })

    const firstSession = await service.createSession({ cols: 80, rows: 24 }, vi.fn())
    const secondSession = await service.createSession({ cols: 100, rows: 30 }, vi.fn())

    expect(envProvider).toHaveBeenCalledTimes(2)
    expect(firstSession.shell).toBe('/bin/zsh')
    expect(secondSession.shell).toBe('/bin/fish')
    expect(ptyBackend.spawn).toHaveBeenNthCalledWith(1, '/bin/zsh', [], expect.objectContaining({
      cwd: '/home/first',
      env: expect.objectContaining({
        HOME: '/home/first',
        PATH: '/dynamic/first/bin',
        TERM: 'xterm-256color',
      }),
    }))
    expect(ptyBackend.spawn).toHaveBeenNthCalledWith(2, '/bin/fish', [], expect.objectContaining({
      cwd: '/home/second',
      env: expect.objectContaining({
        HOME: '/home/second',
        PATH: '/dynamic/second/bin',
        TERM: 'xterm-256color',
      }),
    }))
  })

  it('falls back to static env when envProvider fails', async () => {
    const fakePty = new FakePty()
    const ptyBackend = {
      spawn: vi.fn(() => fakePty),
    }
    const loggerDebug = vi.spyOn(electronLogger, 'debug').mockImplementation(() => undefined)
    const service = new ShellPtyService({
      env: {
        HOME: '/home/static',
        PATH: '/static/bin',
        SHELL: '/bin/bash',
      },
      envProvider: vi.fn(async () => {
        throw new Error('manifest unavailable')
      }),
      platform: 'linux',
      ptyBackend,
    })

    const session = await service.createSession({ cols: 80, rows: 24 }, vi.fn())

    expect(session.shell).toBe('/bin/bash')
    expect(ptyBackend.spawn).toHaveBeenCalledWith('/bin/bash', [], expect.objectContaining({
      cwd: '/home/static',
      env: expect.objectContaining({
        HOME: '/home/static',
        PATH: '/static/bin',
        TERM: 'xterm-256color',
      }),
    }))
    expect(loggerDebug).toHaveBeenCalledWith(
      '[shell] env provider failed: %s',
      'manifest unavailable',
    )
  })

  it('rejects operations for unknown or exited sessions', async () => {
    const fakePty = new FakePty()
    const service = new ShellPtyService({
      env: {
        HOME: '/home/ecos',
        SHELL: '/bin/bash',
      },
      platform: 'linux',
      ptyBackend: {
        spawn: vi.fn(() => fakePty),
      },
    })
    const session = await service.createSession({ cols: 80, rows: 24 }, vi.fn())

    fakePty.emitExit({ exitCode: 0 })

    expect(() => service.write(session.sessionId, 'pwd\r')).toThrow('Unknown shell session')
    expect(() => service.resize('missing', 100, 28)).toThrow('Unknown shell session')
    expect(() => service.kill('missing')).toThrow('Unknown shell session')
  })
})
