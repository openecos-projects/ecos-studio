import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdkInstallationSnapshot } from '@ecos-studio/shared'

import { listPdkInstallationsApi } from '@/api/plugin'
import { loadAgentPdkInstallations } from './agentPdkInstallations'

vi.mock('@/api/plugin', () => ({
  listPdkInstallationsApi: vi.fn(async () => []),
}))

function makeInstallation(
  overrides: Partial<PdkInstallationSnapshot> = {},
): PdkInstallationSnapshot {
  return {
    id: 'pdk-installation:ics55',
    familyId: 'ics55',
    displayName: 'ICS55',
    version: '1.0',
    root: '/pdks/ics55',
    ownership: 'managed',
    registrySha256: null,
    readiness: 'ready',
    reason: null,
    supportsEccDefaults: true,
    ...overrides,
  }
}

describe('loadAgentPdkInstallations', () => {
  beforeEach(() => {
    vi.mocked(listPdkInstallationsApi).mockReset()
    vi.mocked(listPdkInstallationsApi).mockResolvedValue([])
  })

  it('maps ready and unverified installations to agent session choices', async () => {
    vi.mocked(listPdkInstallationsApi).mockResolvedValue([
      makeInstallation(),
      makeInstallation({
        id: 'pdk-installation:local',
        displayName: 'ICS55 local',
        ownership: 'imported',
        readiness: 'unverified',
        root: '/local/ics55',
        version: null,
      }),
    ])

    await expect(loadAgentPdkInstallations()).resolves.toEqual([
      { name: 'ICS55', path: '/pdks/ics55', source: 'managed', version: '1.0' },
      { name: 'ICS55 local', path: '/local/ics55', source: 'imported' },
    ])
  })

  it('drops installations the workspace wizard would mark ineligible', async () => {
    vi.mocked(listPdkInstallationsApi).mockResolvedValue([
      makeInstallation({ readiness: 'missing' }),
      makeInstallation({ readiness: 'invalid' }),
    ])

    await expect(loadAgentPdkInstallations()).resolves.toEqual([])
  })

  it('returns an empty list when the inventory is unavailable', async () => {
    vi.mocked(listPdkInstallationsApi).mockRejectedValue(new Error('bridge unavailable'))

    await expect(loadAgentPdkInstallations()).resolves.toEqual([])
  })
})
