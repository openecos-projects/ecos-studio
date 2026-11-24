// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import router from './index'

const { hasOpenWorkspace } = vi.hoisted(() => ({ hasOpenWorkspace: vi.fn(() => false) }))
vi.mock('../composables/useWorkspace', () => ({ hasOpenWorkspace }))
vi.mock('../views/WelcomeView.vue', () => ({ default: {} }))
vi.mock('../views/ECCView.vue', () => ({ default: {} }))
vi.mock('../views/WorkspaceViewWrapper.vue', () => ({ default: {} }))
vi.mock('../views/WorkspaceRouteView.vue', () => ({ default: {} }))

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

  it('lets the app restore an initial workspace route', async () => {
    await router.push('/workspace/home')

    expect(router.currentRoute.value.path).toBe('/workspace/home')
  })

  it('returns to Backend Design when navigating without an open workspace', async () => {
    await router.push('/ecc')
    await router.push('/workspace/synthesis')

    expect(router.currentRoute.value.path).toBe('/ecc')
  })

  it('opens flow steps when a workspace is open', async () => {
    hasOpenWorkspace.mockReturnValueOnce(true)
    await router.push('/workspace/synthesis')

    expect(router.currentRoute.value.path).toBe('/workspace/synthesis')
  })
})
