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
    warning: null,
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

  it('shows an install action when not installed', async () => {
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
    const wrapper = mount(CliInstallerCard)
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
    expect(bar.attributes('aria-label')).toBe('ECC CLI install progress')
    expect(wrapper.text()).toContain('Downloading ecc')
  })

  it('shows progress for user-initiated installs and disables the buttons', async () => {
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
    let releaseInstall: (() => void) | null = null
    mocks.installCli.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseInstall = () => resolve(readyState())
        }),
    )
    const wrapper = mount(CliInstallerCard)
    await flushPromises()

    const installButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Install')!
    await installButton.trigger('click')

    mocks.emitProgress({
      id: 'job-2',
      resource_id: 'tool:ecc',
      action: 'install',
      phase: 'downloading',
      progress: 0.3,
      message: 'Downloading ecc v0.1.0-alpha.11...',
      error: null,
    })
    await flushPromises()

    expect(wrapper.find('[role="progressbar"]').exists()).toBe(true)
    expect(
      wrapper
        .findAll('button')
        .every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)

    releaseInstall!()
    // The card refreshes from the service, which now reports the finished install.
    mocks.fetchStatus.mockResolvedValue(readyState())
    await flushPromises()
    expect(wrapper.text()).toContain('Ready')
  })

  it('refreshes status when a terminal progress event arrives', async () => {
    const wrapper = mount(CliInstallerCard)
    await flushPromises()
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(1)

    mocks.emitProgress({
      id: 'job-3',
      resource_id: 'tool:ecc',
      action: 'install',
      phase: 'done',
      progress: 1,
      message: 'installed',
      error: null,
    })
    await flushPromises()

    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
  })

  it('disables actions while a background drift install is in flight', async () => {
    const wrapper = mount(CliInstallerCard)
    await flushPromises()
    expect(wrapper.text()).toContain('Ready')

    // A background first-use/drift install starts in the main process.
    mocks.emitProgress({
      id: 'job-5',
      resource_id: 'tool:ecc',
      action: 'install',
      phase: 'downloading',
      progress: 0.4,
      message: 'Downloading ecc v0.1.0-alpha.11...',
      error: null,
    })
    await flushPromises()

    expect(wrapper.find('[role="progressbar"]').exists()).toBe(true)
    expect(
      wrapper
        .findAll('button')
        .every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)

    // Completion clears the progress and re-enables the actions.
    mocks.emitProgress({
      id: 'job-6',
      resource_id: 'tool:ecc',
      action: 'install',
      phase: 'done',
      progress: 1,
      message: 'ECC bundle installed successfully',
      error: null,
    })
    await flushPromises()
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.attributes('disabled') !== undefined),
    ).toBe(false)
  })

  it('unsubscribes from progress events on unmount', async () => {
    const wrapper = mount(CliInstallerCard)
    await flushPromises()
    wrapper.unmount()

    const callsBefore = mocks.fetchStatus.mock.calls.length
    mocks.emitProgress({
      id: 'job-4',
      resource_id: 'tool:ecc',
      action: 'install',
      phase: 'downloading',
      progress: 0.5,
      message: 'late event',
      error: null,
    })
    await flushPromises()
    expect(mocks.fetchStatus.mock.calls.length).toBe(callsBefore)
  })

  it('offers the shim install in development mode only while it is missing', async () => {
    mocks.fetchStatus.mockResolvedValue(
      baseState({
        status: 'dev-wrapper',
        source: null,
        versionDir: null,
        shimPath: null,
        selfCheck: null,
      }),
    )
    const wrapper = mount(CliInstallerCard)
    await flushPromises()
    expect(wrapper.text()).toContain('Install')
    expect(
      wrapper.findAll('button').some((button) => button.text() === 'Uninstall'),
    ).toBe(false)

    mocks.fetchStatus.mockResolvedValue(baseState({ status: 'dev-wrapper' }))
    const installed = mount(CliInstallerCard)
    await flushPromises()
    expect(
      installed.findAll('button').some((button) => button.text() === 'Uninstall'),
    ).toBe(true)
    expect(
      installed.findAll('button').some((button) => button.text() === 'Reinstall'),
    ).toBe(false)
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
