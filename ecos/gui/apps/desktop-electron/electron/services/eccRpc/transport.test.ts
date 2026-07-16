import { describe, expect, it } from 'vitest'

import {
  ContentLengthDecoder,
  TransportError,
  encodeContentLengthFrame,
} from './transport'

describe('ECC RPC stdio transport', () => {
  it('encodes payloads with a Content-Length header', () => {
    const frame = encodeContentLengthFrame('{"jsonrpc":"2.0","id":1}')

    expect(frame.toString('utf8')).toBe(
      'Content-Length: 24\r\n\r\n{"jsonrpc":"2.0","id":1}',
    )
  })

  it('uses byte length instead of character count', () => {
    const frame = encodeContentLengthFrame('{"text":"布局"}')

    expect(frame.toString('utf8')).toBe('Content-Length: 17\r\n\r\n{"text":"布局"}')
  })

  it('decodes a complete frame', () => {
    const decoder = new ContentLengthDecoder()

    const messages = decoder.feed(
      Buffer.from('Content-Length: 17\r\n\r\n{"ok":true,"n":1}', 'utf8'),
    )

    expect(messages).toEqual(['{"ok":true,"n":1}'])
  })

  it('buffers partial frames until the body is complete', () => {
    const decoder = new ContentLengthDecoder()

    expect(decoder.feed('Content-Length: 17\r\n\r\n{"ok"')).toEqual([])
    expect(decoder.feed(':true,"n":1}')).toEqual(['{"ok":true,"n":1}'])
  })

  it('decodes multiple frames from one chunk', () => {
    const decoder = new ContentLengthDecoder()
    const first = encodeContentLengthFrame('{"id":1}')
    const second = encodeContentLengthFrame('{"id":2}')

    expect(decoder.feed(Buffer.concat([first, second]))).toEqual(['{"id":1}', '{"id":2}'])
  })

  it('rejects malformed headers', () => {
    const decoder = new ContentLengthDecoder()

    expect(() => decoder.feed('Content-Type: text/plain\r\n\r\nhello')).toThrow(
      TransportError,
    )
  })

  it('rejects invalid content lengths', () => {
    const decoder = new ContentLengthDecoder()

    expect(() => decoder.feed('Content-Length: nope\r\n\r\nhello')).toThrow(
      TransportError,
    )
  })
})
