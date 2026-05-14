import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import routerSource from './index.ts?raw'

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    createWebHashHistory: actual.createMemoryHistory,
  }
})

const { default: router } = await import('./index')

describe('router SoC welcome routes', () => {
  it('resolves SoC routes under the welcome shell and lazy-loads their components', async () => {
    const galleryRoute = router.resolve('/soc')
    expect(galleryRoute.name).toBe('SoCGallery')
    expect(galleryRoute.matched.map((record) => record.path)).toEqual(['/', '/soc'])

    const detailRoute = router.resolve('/soc/retro-template')
    expect(detailRoute.name).toBe('SoCTemplateDetail')
    expect(detailRoute.params).toEqual({ templateId: 'retro-template' })
    expect(detailRoute.matched.map((record) => record.path)).toEqual(['/', '/soc/:templateId'])

    const galleryRecord = router.getRoutes().find((record) => record.name === 'SoCGallery')
    const detailRecord = router.getRoutes().find((record) => record.name === 'SoCTemplateDetail')

    expect(galleryRecord?.components?.default).toBeTypeOf('function')
    expect(detailRecord?.components?.default).toBeTypeOf('function')
    expect(detailRecord?.props).toEqual({ default: true })
    const routerDir = dirname(new URL(import.meta.url).pathname)
    const galleryImportPath = '../views/SoCTemplateGalleryView.vue'
    const detailImportPath = '../views/SoCTemplateDetailView.vue'
    const galleryResolvedPath = '/src/views/SoCTemplateGalleryView.vue'
    const detailResolvedPath = '/src/views/SoCTemplateDetailView.vue'

    expect(routerSource).toContain(
      `{ path: 'soc', name: 'SoCGallery', component: () => import('${galleryImportPath}') }`,
    )
    expect(routerSource).toContain(
      `{ path: 'soc/:templateId', name: 'SoCTemplateDetail', component: () => import('${detailImportPath}'), props: true }`,
    )
    expect(String(galleryRecord?.components?.default)).toContain(galleryResolvedPath)
    expect(String(detailRecord?.components?.default)).toContain(detailResolvedPath)
    expect(existsSync(resolve(routerDir, galleryImportPath))).toBe(true)
    expect(existsSync(resolve(routerDir, detailImportPath))).toBe(true)
  })
})
