import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DesktopSettingsValue } from '@ecos-studio/shared'

type SettingsRecord = Record<string, DesktopSettingsValue>

function cloneValue<T extends DesktopSettingsValue>(value: T): T {
  return structuredClone(value)
}

export interface SettingsStoreOptions {
  filePath?: string
}

export class SettingsStore {
  private readonly filePath: string
  private cache: SettingsRecord | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: SettingsStoreOptions = {}) {
    this.filePath = options.filePath ?? join(process.cwd(), 'settings.json')
  }

  async get<T extends DesktopSettingsValue = DesktopSettingsValue>(key: string): Promise<T | null> {
    await this.writeChain

    const settings = await this.readAll()
    const value = settings[key]

    if (value === undefined) {
      return null
    }

    return cloneValue(value as T)
  }

  async set(key: string, value: DesktopSettingsValue): Promise<void> {
    await this.enqueueWrite(async () => {
      const settings = await this.readAll()
      settings[key] = cloneValue(value)
      await this.writeAll(settings)
    })
  }

  async delete(key: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const settings = await this.readAll()

      if (!(key in settings)) {
        return
      }

      delete settings[key]
      await this.writeAll(settings)
    })
  }

  private async readAll(): Promise<SettingsRecord> {
    if (this.cache) {
      return { ...this.cache }
    }

    try {
      const content = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(content) as unknown

      if (parsed == null || Array.isArray(parsed) || typeof parsed !== 'object') {
        this.cache = {}
        return {}
      }

      this.cache = parsed as SettingsRecord
      return { ...this.cache }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException

      if (nodeError.code === 'ENOENT') {
        this.cache = {}
        return {}
      }

      throw error
    }
  }

  private async writeAll(settings: SettingsRecord): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })

    const tempFilePath = `${this.filePath}.tmp`
    const content = `${JSON.stringify(settings, null, 2)}\n`

    await writeFile(tempFilePath, content, 'utf8')
    await rename(tempFilePath, this.filePath)
    this.cache = { ...settings }
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const nextWrite = this.writeChain.then(operation)
    this.writeChain = nextWrite.then(
      () => undefined,
      () => undefined,
    )
    await nextWrite
  }
}
