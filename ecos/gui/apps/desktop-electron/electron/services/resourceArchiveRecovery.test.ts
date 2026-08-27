import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  prepareResourceArchive,
  removeCompletedResourceArchive,
  type PrepareResourceArchiveOptions,
  type ResourceArchiveSha256Verifier,
} from './resourceArchiveRecovery'

const RESOURCE_ID = 'tool:yosys'
const VERSION = '2026-05-13'
const SOURCE_URL = 'https://example.com/yosys.tar'
const OPERATION_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
]
const tempDirectories: string[] = []

interface ExpectedArchivePaths {
  checksumArchivePath: string
  legacyArchivePath: string
  partialArchivePath: string
}

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ecos-archive-recovery-'))
  tempDirectories.push(directory)
  return directory
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function expectedArchivePaths(
  resourcesDir: string,
  expectedSha256: string,
): ExpectedArchivePaths {
  const sourceHash = createHash('sha256').update(SOURCE_URL).digest('hex').slice(0, 12)
  const checksumHash = createHash('sha256')
    .update(expectedSha256.toLowerCase())
    .digest('hex')
    .slice(0, 16)
  const legacyStem = `tool-yosys-${VERSION}-${sourceHash}`
  const downloadsDir = join(resourcesDir, 'downloads')
  return {
    checksumArchivePath: join(downloadsDir, `${legacyStem}-${checksumHash}.tar`),
    legacyArchivePath: join(downloadsDir, `${legacyStem}.tar`),
    partialArchivePath: join(downloadsDir, `${legacyStem}-${checksumHash}.tar.part`),
  }
}

function operationArchivePath(archivePath: string, operationId: string): string {
  return `${archivePath.slice(0, -'.tar'.length)}-${operationId}.tar`
}

const verifySha256: ResourceArchiveSha256Verifier = async (
  filePath,
  expected,
  signal,
) => {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
  return sha256(await readFile(filePath)) === expected.toLowerCase()
}

function prepareOptions(
  resourcesDir: string,
  expectedSha256: string,
  overrides: Partial<PrepareResourceArchiveOptions> = {},
): PrepareResourceArchiveOptions {
  return {
    expectedSha256,
    resourceId: RESOURCE_ID,
    resourcesDir,
    sha256Verifier: verifySha256,
    signal: new AbortController().signal,
    sourceUrl: SOURCE_URL,
    version: VERSION,
    ...overrides,
  }
}

async function expectMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
}

describe('prepareResourceArchive', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(
      tempDirectories.splice(0).map(async (directory) => {
        await rm(directory, { force: true, recursive: true })
      }),
    )
  })

  it('returns one stable partial path and a unique completed path per operation', async () => {
    const root = await createTempDir()
    const expectedSha256 = sha256('archive payload')

    const first = await prepareResourceArchive(prepareOptions(root, expectedSha256))
    const second = await prepareResourceArchive(prepareOptions(root, expectedSha256))

    expect(first.partialArchivePath).toBe(second.partialArchivePath)
    expect(first.completedArchivePath).not.toBe(second.completedArchivePath)
    expect(basename(first.partialArchivePath)).toMatch(
      /^tool-yosys-2026-05-13-[0-9a-f]{12}-[0-9a-f]{16}\.tar\.part$/,
    )
    expect(basename(first.completedArchivePath)).toMatch(
      /^tool-yosys-2026-05-13-[0-9a-f]{12}-[0-9a-f]{16}-[0-9a-f-]{36}\.tar$/,
    )
    await expect(stat(join(root, 'downloads'))).resolves.toMatchObject({})
  })

  it('removes a completed archive after installation', async () => {
    const root = await createTempDir()
    const completedArchive = join(root, 'downloads', 'completed.tar')
    await mkdir(join(root, 'downloads'), { recursive: true })
    await writeFile(completedArchive, 'archive payload')

    removeCompletedResourceArchive(completedArchive, RESOURCE_ID)

    await vi.waitFor(async () => await expectMissing(completedArchive))
    await expect(stat(completedArchive)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['checksum-scoped', 'legacy'] as const)(
    'recovers and cleans completed %s operation archives',
    async (archiveFormat) => {
      const root = await createTempDir()
      const payload = Buffer.from('completed archive payload')
      const expectedSha256 = sha256(payload)
      const paths = expectedArchivePaths(root, expectedSha256)
      const baseArchivePath =
        archiveFormat === 'checksum-scoped'
          ? paths.checksumArchivePath
          : paths.legacyArchivePath
      const interruptedArchives = OPERATION_IDS.map((operationId) =>
        operationArchivePath(baseArchivePath, operationId),
      )
      await mkdir(join(root, 'downloads'), { recursive: true })
      await Promise.all(
        interruptedArchives.map(async (path) => await writeFile(path, payload)),
      )
      const verifier = vi.fn(verifySha256)
      const signal = new AbortController().signal

      const prepared = await prepareResourceArchive(
        prepareOptions(root, expectedSha256, { sha256Verifier: verifier, signal }),
      )

      await expect(readFile(prepared.partialArchivePath)).resolves.toEqual(payload)
      expect(verifier).toHaveBeenCalledWith(
        interruptedArchives[0],
        expectedSha256,
        signal,
      )
      for (const interruptedArchive of interruptedArchives) {
        await expectMissing(interruptedArchive)
      }
    },
  )

  it('leaves an unusable recovery candidate for a fresh download fallback', async () => {
    const root = await createTempDir()
    const payload = Buffer.from('completed archive payload')
    const expectedSha256 = sha256(payload)
    const paths = expectedArchivePaths(root, expectedSha256)
    const candidate = operationArchivePath(paths.legacyArchivePath, OPERATION_IDS[0])
    await mkdir(join(root, 'downloads'), { recursive: true })
    await writeFile(candidate, payload)

    const prepared = await prepareResourceArchive(
      prepareOptions(root, expectedSha256, {
        fileOperations: {
          rename: async (sourcePath, destinationPath) => {
            if (sourcePath === candidate) {
              throw Object.assign(new Error('archive is locked'), { code: 'EPERM' })
            }
            await rename(sourcePath, destinationPath)
          },
        },
      }),
    )

    await expect(readFile(candidate)).resolves.toEqual(payload)
    await expectMissing(prepared.partialArchivePath)
  })

  it.each(['EACCES', 'EPERM', 'EBUSY'])(
    'falls back when recovery candidates cannot be enumerated (%s)',
    async (code) => {
      const root = await createTempDir()
      const verifier = vi.fn(verifySha256)
      const prepared = await prepareResourceArchive(
        prepareOptions(root, sha256('archive payload'), {
          fileOperations: {
            readDirectory: async () => {
              throw Object.assign(new Error(`unable to enumerate: ${code}`), { code })
            },
          },
          sha256Verifier: verifier,
        }),
      )

      expect(prepared.partialArchivePath).toMatch(/\.tar\.part$/)
      expect(verifier).not.toHaveBeenCalled()
      await expectMissing(prepared.partialArchivePath)
    },
  )

  it('rejects and removes a legacy archive from an obsolete registry lock', async () => {
    const root = await createTempDir()
    const stalePayload = Buffer.from('old archive payload')
    const expectedSha256 = sha256('new archive payload')
    const paths = expectedArchivePaths(root, expectedSha256)
    const candidate = operationArchivePath(paths.legacyArchivePath, OPERATION_IDS[0])
    await mkdir(join(root, 'downloads'), { recursive: true })
    await writeFile(candidate, stalePayload)

    const prepared = await prepareResourceArchive(prepareOptions(root, expectedSha256))

    expect(prepared.partialArchivePath).toBe(paths.partialArchivePath)
    await expectMissing(candidate)
    await expectMissing(prepared.partialArchivePath)
  })

  it('preserves the current partial while removing superseded checksum archives', async () => {
    const root = await createTempDir()
    const payload = Buffer.from('current archive payload')
    const stalePayload = Buffer.from('superseded archive payload')
    const expectedSha256 = sha256(payload)
    const paths = expectedArchivePaths(root, expectedSha256)
    const stalePaths = expectedArchivePaths(root, sha256(stalePayload))
    const staleArchives = [
      stalePaths.checksumArchivePath,
      stalePaths.partialArchivePath,
      operationArchivePath(stalePaths.checksumArchivePath, OPERATION_IDS[0]),
    ]
    await mkdir(join(root, 'downloads'), { recursive: true })
    await writeFile(paths.partialArchivePath, payload)
    await Promise.all(
      staleArchives.map(async (path) => await writeFile(path, stalePayload)),
    )
    const verifier = vi.fn(verifySha256)

    const prepared = await prepareResourceArchive(
      prepareOptions(root, expectedSha256, { sha256Verifier: verifier }),
    )

    expect(prepared.partialArchivePath).toBe(paths.partialArchivePath)
    await expect(readFile(paths.partialArchivePath)).resolves.toEqual(payload)
    expect(verifier).not.toHaveBeenCalled()
    for (const staleArchive of staleArchives) await expectMissing(staleArchive)
  })

  it('continues when a superseded checksum archive cannot be removed', async () => {
    const root = await createTempDir()
    const stalePayload = Buffer.from('superseded archive payload')
    const expectedSha256 = sha256('current archive payload')
    const stalePaths = expectedArchivePaths(root, sha256(stalePayload))
    await mkdir(join(root, 'downloads'), { recursive: true })
    await writeFile(stalePaths.partialArchivePath, stalePayload)

    const prepared = await prepareResourceArchive(
      prepareOptions(root, expectedSha256, {
        fileOperations: {
          remove: async (path) => {
            if (path === stalePaths.partialArchivePath) {
              throw Object.assign(new Error('archive is locked'), { code: 'EPERM' })
            }
            await rm(path, { force: true })
          },
        },
      }),
    )

    await expect(readFile(stalePaths.partialArchivePath)).resolves.toEqual(stalePayload)
    await expectMissing(prepared.partialArchivePath)
  })

  it('rejects a pre-aborted preparation before touching the downloads directory', async () => {
    const root = await createTempDir()
    const controller = new AbortController()
    const verifier = vi.fn(verifySha256)
    controller.abort()

    await expect(
      prepareResourceArchive(
        prepareOptions(root, sha256('archive payload'), {
          sha256Verifier: verifier,
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(verifier).not.toHaveBeenCalled()
    await expectMissing(join(root, 'downloads'))
  })

  it('propagates cancellation raised while verifying a recovery candidate', async () => {
    const root = await createTempDir()
    const payload = Buffer.from('completed archive payload')
    const expectedSha256 = sha256(payload)
    const paths = expectedArchivePaths(root, expectedSha256)
    const candidate = operationArchivePath(paths.legacyArchivePath, OPERATION_IDS[0])
    const controller = new AbortController()
    await mkdir(join(root, 'downloads'), { recursive: true })
    await writeFile(candidate, payload)

    await expect(
      prepareResourceArchive(
        prepareOptions(root, expectedSha256, {
          sha256Verifier: async () => {
            controller.abort()
            throw new DOMException('The operation was aborted.', 'AbortError')
          },
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(readFile(candidate)).resolves.toEqual(payload)
    await expectMissing(paths.partialArchivePath)
  })
})
