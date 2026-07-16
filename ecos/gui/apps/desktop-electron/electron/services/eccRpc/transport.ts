const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', 'ascii')
const CONTENT_LENGTH_PATTERN = /^Content-Length:\s*(\d+)$/i

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
