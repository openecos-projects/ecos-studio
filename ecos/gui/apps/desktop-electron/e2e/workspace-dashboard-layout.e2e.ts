import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { launchE2EApp, repoRoot, resolveOutDir, type E2EApp } from './support/launch'
import { prepareGcdProject } from './support/design'
import { setupBackendWorkspace } from './support/journey'
import { createMilestoneShots } from './support/screenshots'

async function readLayout(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!
      const bounds = element.getBoundingClientRect()
      const width = selector === '.flow-scroll' ? element.clientWidth : bounds.width
      const height = selector === '.flow-scroll' ? element.clientHeight : bounds.height
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.left + width,
        bottom: bounds.top + height,
        width,
        height,
      }
    }
    return {
      flow: rect('.workspace-flow-dashboard'),
      overview: rect('.flow-overview'),
      qor: rect('.qor-card'),
      viewport: rect('.flow-scroll'),
      canvas: rect('.flow-canvas'),
      visibleStepCount: Array.from(
        document.querySelectorAll<HTMLElement>('.flow-step-card'),
      ).filter((card) => {
        const bounds = card.getBoundingClientRect()
        const viewport = rect('.flow-scroll')
        return (
          bounds.left < viewport.right &&
          bounds.right > viewport.left &&
          bounds.top < viewport.bottom &&
          bounds.bottom > viewport.top
        )
      }).length,
      overflowing: Array.from(
        document.querySelectorAll<HTMLElement>('.qor-card, .flow-status-card'),
      )
        .filter(
          (element) =>
            element.scrollHeight > element.clientHeight + 1 ||
            element.scrollWidth > element.clientWidth + 1,
        )
        .map((element) => element.className),
    }
  })
}

function insideViewport(
  card: { left: number; right: number; top: number; bottom: number },
  viewport: { left: number; right: number; top: number; bottom: number },
): boolean {
  return (
    card.left >= viewport.left - 1 &&
    card.right <= viewport.right + 1 &&
    card.top >= viewport.top - 1 &&
    card.bottom <= viewport.bottom + 1
  )
}

describe('workspace dashboard layout', () => {
  let launched: E2EApp | undefined
  let shot: ReturnType<typeof createMilestoneShots>

  beforeAll(async () => {
    const outDir = await resolveOutDir('workspace-dashboard-layout')
    const design = await prepareGcdProject(join(outDir, 'work'))
    launched = await launchE2EApp(outDir)
    shot = createMilestoneShots(launched.page, outDir)
    await setupBackendWorkspace(launched.page, {
      ...design,
      pdkRoot: process.env.ECOS_E2E_PDK_ROOT ?? join(repoRoot, 'pdk/icsprout55-pdk'),
    })
    await launched.page.locator('.flow-step-card').first().waitFor({ state: 'attached' })
  }, 180_000)

  afterAll(async () => {
    await launched?.close()
  })

  async function resize(width: number, height: number) {
    await launched!.app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height)
      },
      { width, height },
    )
    await expect.poll(() => launched!.page.evaluate(() => window.innerWidth)).toBe(width)
  }

  async function assertClearLayout() {
    await expect
      .poll(async () => {
        const layout = await readLayout(launched!.page)
        return {
          qorInViewport: insideViewport(layout.qor, layout.viewport),
          overflowing: layout.overflowing,
        }
      })
      .toEqual({
        qorInViewport: true,
        overflowing: [],
      })
  }

  it.each([
    [1440, 1000],
    [1280, 800],
    [1024, 768],
  ])('keeps cards readable and clear of steps at %s × %s', async (width, height) => {
    await resize(width, height)
    try {
      await assertClearLayout()
      const layout = await readLayout(launched!.page)
      expect(layout.visibleStepCount).toBeGreaterThan(0)
      expect(layout.qor.width).toBeLessThan(layout.flow.width)
      if (width >= 1280) {
        // The top overlay cards share one stretched height.
        expect(layout.qor.height).toBeGreaterThan(0)
      }
      await expect
        .poll(async () => {
          const { canvas, viewport } = await readLayout(launched!.page)
          return Math.max(
            Math.abs(canvas.left + canvas.width / 2 - viewport.left - viewport.width / 2),
            Math.abs(canvas.top + canvas.height / 2 - viewport.top - viewport.height / 2),
          )
        })
        // Chromium reserves a few pixels for the stable scrollbar gutters; keep
        // the assertion focused on meaningful drift rather than subpixel layout.
        .toBeLessThan(12)
    } finally {
      await shot(`dashboard-${width}x${height}`)
    }
  })

  it('keeps the same cards outside the canvas during zoom, pan, and expansion', async () => {
    const page = launched!.page
    await resize(1440, 1000)
    const qorCard = await page.locator('.qor-card').elementHandle()
    await page.getByRole('slider', { name: 'Flow diagram zoom' }).fill('1')
    await page.locator('.flow-scroll').evaluate((element) => {
      element.scrollLeft += 100
      element.scrollTop += 100
    })
    await assertClearLayout()
    await page.getByRole('button', { name: 'Expand flow diagram', exact: true }).click()
    try {
      await assertClearLayout()
      expect(
        await qorCard!.evaluate(
          (element) => element === document.querySelector('.qor-card'),
        ),
      ).toBe(true)
      await shot('dashboard-expanded')
    } finally {
      await page
        .getByRole('button', { name: 'Restore flow diagram', exact: true })
        .click()
    }
    await assertClearLayout()
  })

  it('preserves card readability and clear steps in the alternate theme', async () => {
    const page = launched!.page
    await page.locator('button[title="Switch to dark theme"]').click()
    expect(await page.locator('html').getAttribute('class')).toContain('dark')
    await assertClearLayout()
    await shot('dashboard-dark')
    await page.locator('button[title="Switch to light theme"]').click()
  })

  it('keeps cards clear when the Agent panel reduces the available width', async () => {
    const page = launched!.page
    await resize(1024, 768)
    await page.getByRole('button', { name: 'ECOS Agent', exact: true }).click()
    try {
      await page.getByRole('slider', { name: 'Flow diagram zoom' }).fill('0.75')
      await page.locator('.flow-scroll').evaluate((element) => {
        element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2
        element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
      })
      await assertClearLayout()
      const layout = await readLayout(page)
      expect(layout.qor.width).toBeLessThan(layout.flow.width)
      expect(layout.visibleStepCount).toBeGreaterThan(0)
      await shot('dashboard-with-agent')
    } finally {
      await page.getByRole('button', { name: 'ECOS Agent', exact: true }).click()
    }
  })
})
