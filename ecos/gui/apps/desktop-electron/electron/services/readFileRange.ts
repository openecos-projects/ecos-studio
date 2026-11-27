import type { FileHandle } from 'node:fs/promises'

export async function readFileRange(
  file: FileHandle,
  length: number,
  position = 0,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await file.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    )
    if (!bytesRead) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}
