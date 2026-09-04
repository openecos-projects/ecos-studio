// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliInstallState } from '@ecos-studio/shared'
import CliInstallerCard from './CliInstallerCard.vue'

const mocks = vi.hoisted(() => {
  type ProgressListener = (event: {
    id: string
    resource_id: string
    action: 'install'
    phase: string
    progress: number
    message: string
    error: string | null
  }) => void
  let progressListener: ProgressListener | null = null
  return {
    fetchStatus: vi.fn(),
    installCli: vi.fn(),
    uninstallCli: vi.fn(),
    subscribe: (listener: ProgressListener) => {
      progressListener = listener
      return () => {
        progressListener = null
      }
    },
    emitProgress: (event: Parameters<NonNullable<ProgressListener>>[0]) => {
      progressListener?.(event)
    },
  }
})

vi.mock('@/api/cliInstaller', () => ({
  fetchCliInstallerStatus: mocks.fetchStatus,
  installEccCli: mocks.installCli,
  uninstallEccCli: mocks.uninstallCli,
  subscribeCliInstallerProgress: mocks.subscribe,
}))

function readyState(): CliInstallState {
  return {
    status: 'ready',
    expectedVersion: '0.1.0-alpha.11',
    installedVersion: '0.1.0-alpha.11',
    source: 'bundled',
    versionDir: '/data/ecc-runtime/1.0.0-abcdef12',
    shimPath: '/home/u/.local/bin/ecos-ecc',
    selfCheck: { ok: true, detail: 'ecc 1.0' },
    error: null,
  }
}

function baseState(overrides: Partial<CliInstallState>): CliInstallState {
  return { ...readyState(), ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchStatus.mockResolvedValue(readyState())
  mocks.installCli.mockResolvedValue(readyState())
})

describe('CliInstallerCard', () => {
  it('shows the ready state with version and shim metadata', async () => {
    const wrapper = mount(CliInstallerCard)
    await flushPromises()

    expect(wrapper.find('[role="status"]').text()).toContain('Ready')
    expect(wrapper.text()).toContain('0.1.0-alpha.11')
    expect(wrapper.text()).toContain('ecos-ecc')
    expect(wrapper.find('button').exists()).toBe(true)
    expect(wrapper.text()).toContain('Reinstall')
  })

  it('is hidden in guidance mode once the CLI is ready', async () => {
    const wrapper = mount(CliInstallerCard, {
      props: { showOnlyWhenActionNeeded: true },
    })
    await flushPromises()
    expect(wrapper.find('section').exists()).toBe(false)
  })

  it('shows guidance and an install action when not installed', async () => {
    mocks.fetchStatus.mockResolvedValue(
      baseState({
        status: 'not-installed',
        installedVersion: null,
        source: null,
        versionDir: null,
        shimPath: null,
        selfCheck: null,
      }),
    )
    const wrapper = mount(CliInstallerCard, {
      props: { showOnlyWhenActionNeeded: true },
    })
    await flushPromises()

    expect(wrapper.find('section').exists()).toBe(true)
    expect(wrapper.text()).toContain('Not installed')
    const installButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Install')
    expect(installButton).toBeDefined()

    installButton!.trigger('click')
    await flushPromises()
    expect(mocks.installCli).toHaveBeenCalledTimes(1)
  })

  it('renders install progress from progress events', async () => {
    mocks.fetchStatus.mockResolvedValue(
      baseState({
        status: 'installing',
        installedVersion: null,
        versionDir: null,
        shimPath: null,
        selfCheck: null,
      }),
    )
    const wrapper = mount(CliInstallerCard)
    await flushPromises()

    mocks.emitProgress({
      id: 'job-1',
      resource_id: 'tool:ecc',
      action: 'install',
      phase: 'downloading',
      progress: 0.42,
      message: 'Downloading ecc v0.1.0-alpha.11...',
      error: null,
    })
    await flushPromises()

    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.exists()).toBe(true)
    expect(bar.attributes('aria-valuenow')).toBe('42')
    expect(wrapper.text()).toContain('Downloading ecc')
  })

  it('surfaces failures with a retry action', async () => {
    mocks.fetchStatus.mockResolvedValue(
      baseState({
        status: 'failed',
        installedVersion: null,
        source: null,
        versionDir: null,
        shimPath: null,
        selfCheck: null,
        error: 'SHA256 verification failed',
      }),
    )
    const wrapper = mount(CliInstallerCard)
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('SHA256')
    expect(wrapper.text()).toContain('Install')
  })

  it('shows an unsupported warning without actions on non-Linux platforms', async () => {
    mocks.fetchStatus.mockResolvedValue(
      baseState({
        status: 'unsupported',
        installedVersion: null,
        source: null,
        versionDir: null,
        shimPath: null,
        selfCheck: null,
        error: 'Linux only',
      }),
    )
    const wrapper = mount(CliInstallerCard)
    await flushPromises()

    expect(wrapper.text()).toContain('Unsupported')
    expect(wrapper.text()).toContain('requires Linux')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })
})
