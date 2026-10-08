import { defineConfig } from 'vitest/config'

// Product e2e: drives the built app through the preload API against real
// sidecars and the real PDK. Files use the `.e2e.ts` suffix so the default
// unit-test run never picks them up.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: Number(process.env.ECOS_E2E_TEST_TIMEOUT_MS ?? 45 * 60_000),
    hookTimeout: 10 * 60_000,
  },
})
