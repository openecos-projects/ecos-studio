import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright-core'

/**
 * Milestone screenshots: numbered PNGs under <outDir>/shots/, taken on
 * success AND failure so CI artifacts always show what the real UI displayed
 * at each key moment. Optionally hash-navigates first so the shot reflects
 * the relevant view (the renderer uses a hash router).
 */
export function createMilestoneShots(page: Page, outDir: string) {
  let index = 0
  return async (name: string, hashRoute?: string): Promise<string> => {
    if (hashRoute) {
      await page.evaluate((hash) => {
        window.location.hash = hash
      }, hashRoute)
      await page.waitForTimeout(1200)
    }
    index += 1
    const dir = join(outDir, 'shots')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${String(index).padStart(2, '0')}-${name}.png`)
    await page.screenshot({ path })
    return path
  }
}
