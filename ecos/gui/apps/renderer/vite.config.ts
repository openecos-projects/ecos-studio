/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { createRendererViteConfig } from './vite.shared'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) =>
  createRendererViteConfig({
    command,
    mode,
    aliasTarget: fileURLToPath(new URL('./src', import.meta.url)),
    fsAllow: ['../../..'],
    includeTestConfig: true,
  }),
)
