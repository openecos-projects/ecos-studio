/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'
import { createRendererViteConfig } from '../renderer/vite.shared'

const packageRoot = fileURLToPath(new URL('.', import.meta.url))
const guiRoot = resolve(packageRoot, '../..')
const rendererRoot = resolve(packageRoot, '../renderer')
const workspaceRoot = resolve(guiRoot, '..')
const bundledMainDeps = ['@ecos-studio/shared', '@ecos-studio/tile-helper']
const bundledPreloadDeps = ['@ecos-studio/shared']
const workspacePackageAliases = {
  '@ecos-studio/shared': resolve(guiRoot, 'packages/shared/src/index.ts'),
  '@ecos-studio/tile-helper': resolve(guiRoot, 'packages/tile-helper/src/index.ts'),
}

export default defineConfig(({ command, mode }) => {
  const isProd = command === 'build' && mode !== 'development'

  return {
    main: {
      resolve: {
        alias: workspacePackageAliases,
      },
      build: {
        externalizeDeps: {
          exclude: bundledMainDeps,
        },
        outDir: resolve(packageRoot, 'dist/main'),
        emptyOutDir: true,
        lib: {
          entry: resolve(packageRoot, 'electron/main/index.ts'),
          formats: ['es'],
        },
        rollupOptions: {
          external: ['electron', /^node:.*/],
        },
      },
    },
    preload: {
      resolve: {
        alias: workspacePackageAliases,
      },
      build: {
        externalizeDeps: {
          exclude: bundledPreloadDeps,
        },
        outDir: resolve(packageRoot, 'dist/preload'),
        emptyOutDir: false,
        lib: {
          entry: resolve(packageRoot, 'electron/preload/index.ts'),
          formats: ['cjs'],
        },
        rollupOptions: {
          external: ['electron', /^node:.*/],
        },
      },
    },
    renderer: {
      ...createRendererViteConfig({
        command,
        mode,
        root: rendererRoot,
        aliasTarget: resolve(rendererRoot, 'src'),
        fsAllow: [workspaceRoot],
        build: {
          outDir: resolve(packageRoot, 'dist/renderer'),
          emptyOutDir: false,
          input: resolve(rendererRoot, 'index.html'),
        },
      }),
    },
  }
})
