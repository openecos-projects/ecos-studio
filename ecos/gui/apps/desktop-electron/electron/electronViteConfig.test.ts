import { describe, expect, it } from 'vitest'
import electronViteConfig from '../electron.vite.config'

describe('desktop electron build config', () => {
  it('bundles workspace packages into main and preload builds instead of externalizing them', () => {
    const resolvedConfig = typeof electronViteConfig === 'function'
      ? electronViteConfig({
          command: 'build',
          isPreview: false,
          mode: 'production',
        })
      : electronViteConfig

    expect(resolvedConfig.main?.build?.externalizeDeps).toEqual(expect.objectContaining({
      exclude: ['@ecos-studio/shared'],
    }))
    expect(resolvedConfig.preload?.build?.externalizeDeps).toEqual(expect.objectContaining({
      exclude: ['@ecos-studio/shared'],
    }))
    expect(resolvedConfig.main?.resolve?.alias).toMatchObject({
      '@ecos-studio/shared': expect.stringContaining('/packages/shared/src/index.ts'),
    })
    expect(resolvedConfig.preload?.resolve?.alias).toMatchObject({
      '@ecos-studio/shared': expect.stringContaining('/packages/shared/src/index.ts'),
    })
  })

  it('lets the renderer dev server pick a free port after the preferred port', () => {
    const resolvedConfig = typeof electronViteConfig === 'function'
      ? electronViteConfig({
          command: 'serve',
          isPreview: false,
          mode: 'development',
        })
      : electronViteConfig

    expect(resolvedConfig.renderer?.server).toEqual(expect.objectContaining({
      port: 1420,
      strictPort: false,
    }))
  })

})
