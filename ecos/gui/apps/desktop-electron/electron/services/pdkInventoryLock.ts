import { mkdir, rmdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout } from 'node:timers/promises'

/** Shared protocol with ECC's pdk.registry; never steal a possibly live lock. */
export async function withPdkInventoryLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true })
  const lock = `${path}.lock`
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      await mkdir(lock)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() >= deadline) throw new Error(`PDK inventory is locked: ${lock}`)
      await setTimeout(50)
    }
  }
  try {
    return await operation()
  } finally {
    await rmdir(lock)
  }
}
