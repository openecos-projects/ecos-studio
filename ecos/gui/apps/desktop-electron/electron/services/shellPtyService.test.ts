import { describe, expect, it, vi } from 'vitest'
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
