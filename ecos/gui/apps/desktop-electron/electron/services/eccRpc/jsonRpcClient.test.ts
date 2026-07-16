import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EccJsonRpcClient,
  EccJsonRpcError,
  EccJsonRpcProtocolError,
  EccJsonRpcTimeoutError,
} from './jsonRpcClient'
import { encodeContentLengthFrame } from './transport'

function decodeWrittenRequest(frame: Buffer): Record<string, unknown> {
  const text = frame.toString('utf8')
  const bodyStart = text.indexOf('\r\n\r\n') + 4
  return JSON.parse(text.slice(bodyStart)) as Record<string, unknown>
}

describe('EccJsonRpcClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes JSON-RPC requests and resolves success responses', async () => {
    const frames: Buffer[] = []
    const client = new EccJsonRpcClient({
      writeFrame: (frame) => frames.push(frame),
    })

    const promise = client.call<{ ok: boolean }>('rpc.ping')
    expect(frames).toHaveLength(1)
    expect(decodeWrittenRequest(frames[0]!)).toMatchObject({
      id: 1,
      jsonrpc: '2.0',
      method: 'rpc.ping',
    })

    client.feedStdout(
      encodeContentLengthFrame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'),
    )

    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('includes params when provided', () => {
    const frames: Buffer[] = []
    const client = new EccJsonRpcClient({
      writeFrame: (frame) => frames.push(frame),
    })

    void client.call('workspace.open', { directory: '/work/demo' })

    expect(decodeWrittenRequest(frames[0]!)).toMatchObject({
      params: { directory: '/work/demo' },
    })
  })

  it('rejects JSON-RPC error responses', async () => {
    const client = new EccJsonRpcClient({ writeFrame: () => undefined })

    const promise = client.call('workspace.open', { directory: '' })
    client.feedStdout(
      encodeContentLengthFrame(
        JSON.stringify({
          error: {
            code: -32602,
            data: { message: 'missing required field: directory' },
            message: 'invalid_request',
          },
          id: 1,
          jsonrpc: '2.0',
        }),
      ),
    )

    await expect(promise).rejects.toMatchObject({
      code: -32602,
      data: { message: 'missing required field: directory' },
      message: 'invalid_request',
      name: 'EccJsonRpcError',
    } satisfies Partial<EccJsonRpcError>)
  })

  it('rejects requests that time out', async () => {
    vi.useFakeTimers()
    const client = new EccJsonRpcClient({ writeFrame: () => undefined })

    const promise = client.call('rpc.ping', undefined, { timeoutMs: 25 })
    vi.advanceTimersByTime(25)

    await expect(promise).rejects.toBeInstanceOf(EccJsonRpcTimeoutError)
  })

  it('ignores a late timed-out response without disrupting a newer request', async () => {
    vi.useFakeTimers()
    const client = new EccJsonRpcClient({ writeFrame: () => undefined })
    const timedOut = client.call('rpc.slow', undefined, { timeoutMs: 25 })
    const timedOutError = timedOut.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(25)
    expect(await timedOutError).toBeInstanceOf(EccJsonRpcTimeoutError)

    const newer = client.call<{ ok: boolean }>('rpc.ping')
    let lateResponseError: unknown
    try {
      client.feedStdout(
        encodeContentLengthFrame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'),
      )
    } catch (error) {
      lateResponseError = error
    }
    client.feedStdout(
      encodeContentLengthFrame('{"jsonrpc":"2.0","id":2,"result":{"ok":true}}'),
    )

    expect(lateResponseError).toBeUndefined()
    await expect(newer).resolves.toEqual({ ok: true })
  })

  it('does not start a timeout timer when timeoutMs is zero', async () => {
    vi.useFakeTimers()
    const client = new EccJsonRpcClient({ writeFrame: () => undefined })

    const promise = client.call('flow.run', undefined, { timeoutMs: 0 })
    await vi.advanceTimersByTimeAsync(120_000)

    client.feedStdout(
      encodeContentLengthFrame('{"jsonrpc":"2.0","id":1,"result":{"rerun":false}}'),
    )

    await expect(promise).resolves.toEqual({ rerun: false })
  })

  it('throws protocol errors for invalid JSON frames', () => {
    const client = new EccJsonRpcClient({ writeFrame: () => undefined })

    expect(() => client.feedStdout(encodeContentLengthFrame('{not json'))).toThrow(
      EccJsonRpcProtocolError,
    )
  })

  it('still throws protocol errors for response ids that were never issued', () => {
    const client = new EccJsonRpcClient({ writeFrame: () => undefined })

    expect(() =>
      client.feedStdout(
        encodeContentLengthFrame('{"jsonrpc":"2.0","id":999,"result":{"ok":true}}'),
      ),
    ).toThrow(EccJsonRpcProtocolError)
  })

  it('rejects pending requests when the process closes', async () => {
    const client = new EccJsonRpcClient({ writeFrame: () => undefined })
    const promise = client.call('rpc.ping')
    const closeError = new Error('sidecar exited')

    client.rejectPending(closeError)

    await expect(promise).rejects.toBe(closeError)
  })
})
