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
  it('redirects the removed Project page to Dashboard with workspace context', () => {
    const query = { projectRoot: '/work/project', workspaceId: 'current' }
    const route = router.resolve({ path: '/workspace/project', query })
    const redirect = route.matched[route.matched.length - 1]?.redirect

    expect(typeof redirect).toBe('function')
    if (typeof redirect !== 'function') throw new Error('Expected Project redirect')
    expect(redirect(route, router.currentRoute.value)).toEqual({
      path: '/workspace/home',
      query,
    })
  })

  it('resolves Tech Library before the dynamic workspace step route', () => {
    const route = router.resolve('/workspace/tech')

    expect(route.name).toBe('TechLibrary')
    expect(route.matched.map((record) => record.path)).toEqual([
      '/workspace',
      '/workspace/tech',
    ])
  })

  it('does not treat the removed Config URL as a dynamic Flow Step', async () => {
    const failure = await router.push('/workspace/configure')

    expect(failure).toBeTruthy()
    expect(router.currentRoute.value.path).not.toBe('/workspace/configure')
  })
})
