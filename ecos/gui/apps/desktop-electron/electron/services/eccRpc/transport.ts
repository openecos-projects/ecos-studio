const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', 'ascii')
const CONTENT_LENGTH_PATTERN = /^Content-Length:\s*(\d+)$/i
const CONTENT_LENGTH_PREFIX = Buffer.from('Content-Length:', 'ascii')

export class TransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransportError'
  }
}

function toBuffer(chunk: Buffer | Uint8Array | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
}

export function encodeContentLengthFrame(payload: string | Uint8Array): Buffer {
  const body = toBuffer(payload)
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii')
  return Buffer.concat([header, body])
}

export class ContentLengthDecoder {
  private buffer = Buffer.alloc(0)

  feed(chunk: Buffer | Uint8Array | string): string[] {
    this.buffer = Buffer.concat([this.buffer, toBuffer(chunk)])

    const messages: string[] = []
    while (this.buffer.byteLength > 0) {
      const separatorIndex = this.buffer.indexOf(HEADER_SEPARATOR)
      if (separatorIndex === -1) {
        return messages
      }

      const headerText = this.buffer.subarray(0, separatorIndex).toString('ascii')
      const contentLength = this.parseContentLength(headerText)
      const bodyStart = separatorIndex + HEADER_SEPARATOR.byteLength
      const bodyEnd = bodyStart + contentLength

      if (this.buffer.byteLength < bodyEnd) {
        return messages
      }

      messages.push(this.buffer.subarray(bodyStart, bodyEnd).toString('utf8'))
      this.buffer = this.buffer.subarray(bodyEnd)
    }

    return messages
  }

  /**
   * Drops a malformed stdout preamble and positions the decoder at the next
   * complete Content-Length frame. Tool output must never permanently poison
   * the sidecar event stream after it leaks onto stdout.
   */
  discardMalformedPrefix(): string {
    const nextFrame = this.buffer.indexOf(CONTENT_LENGTH_PREFIX, 1)
    if (nextFrame > 0) {
      const discarded = this.buffer.subarray(0, nextFrame)
      this.buffer = this.buffer.subarray(nextFrame)
      return discarded.toString('utf8')
    }

    const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR)
    if (headerEnd >= 0) {
      const discarded = this.buffer.subarray(0, headerEnd + HEADER_SEPARATOR.byteLength)
      this.buffer = this.buffer.subarray(headerEnd + HEADER_SEPARATOR.byteLength)
      return discarded.toString('utf8')
    }

    const retainedTailLength = Math.min(
      this.buffer.byteLength,
      CONTENT_LENGTH_PREFIX.byteLength - 1,
    )
    const discarded = this.buffer.subarray(0, this.buffer.byteLength - retainedTailLength)
    this.buffer = this.buffer.subarray(this.buffer.byteLength - retainedTailLength)
    return discarded.toString('utf8')
  }

  private parseContentLength(headerText: string): number {
    const lines = headerText.split(/\r\n/)
    const contentLengthLine = lines.find((line) =>
      line.toLowerCase().startsWith('content-length:'),
    )
    if (!contentLengthLine) {
      throw new TransportError('Missing Content-Length header.')
    }

    const match = CONTENT_LENGTH_PATTERN.exec(contentLengthLine)
    if (!match) {
      throw new TransportError(`Invalid Content-Length header: ${contentLengthLine}`)
    }

    const value = Number(match[1])
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TransportError(`Invalid Content-Length value: ${match[1]}`)
    }

    return value
  }
}
