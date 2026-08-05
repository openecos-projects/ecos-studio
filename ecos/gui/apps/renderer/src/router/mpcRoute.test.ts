// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import router from './index'

describe('MPC resources route', () => {
  it('resolves the dedicated MPC catalog under the welcome shell', () => {
    expect(router.resolve('/mpc')).toMatchObject({
      name: 'MpcResources',
      path: '/mpc',
    })
  })
})

describe('workspace fixed routes', () => {
  it('resolves Tech Library before the dynamic workspace step route', () => {
    const route = router.resolve('/workspace/tech')

    expect(route.name).toBe('TechLibrary')
    expect(route.matched.map((record) => record.path)).toEqual([
      '/workspace',
      '/workspace/tech',
    ])
  })
})
