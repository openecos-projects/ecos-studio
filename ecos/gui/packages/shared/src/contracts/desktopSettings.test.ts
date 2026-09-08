import { describe, expect, it } from 'vitest'

import { isRegistryOwnedSettingKey, SETTINGS_REGISTRY } from './desktopSettings.ts'

const VALID_VALUE_TYPES = new Set(['filePath', 'directoryPath', 'pdkInstallation'])

describe('desktop settings registry contract', () => {
  it('contains exactly the initial registry entries', () => {
    expect(SETTINGS_REGISTRY.map((descriptor) => descriptor.key)).toEqual([
      'runtime.eccPath',
      'runtime.eccSizerRoot',
      'agent.codexBin',
      'pdk.defaultInstallationId',
    ])
  })

  it('keeps registry keys unique', () => {
    const keys = SETTINGS_REGISTRY.map((descriptor) => descriptor.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('requires non-empty category, title, and description on every entry', () => {
    for (const descriptor of SETTINGS_REGISTRY) {
      expect(descriptor.category.trim()).not.toBe('')
      expect(descriptor.title.trim()).not.toBe('')
      expect(descriptor.description.trim()).not.toBe('')
    }
  })

  it('restricts entries to known value types', () => {
    for (const descriptor of SETTINGS_REGISTRY) {
      expect(VALID_VALUE_TYPES.has(descriptor.valueType)).toBe(true)
    }
  })

  it('defaults every entry to the null (built-in resolution) value', () => {
    for (const descriptor of SETTINGS_REGISTRY) {
      expect(descriptor.default).toBeNull()
    }
  })

  it('shares the codex bin key with the existing codex contract', () => {
    const codexEntry = SETTINGS_REGISTRY.find(
      (descriptor) => descriptor.key === 'agent.codexBin',
    )
    expect(codexEntry).toBeDefined()
  })

  it('rejects a registry-shaped entry with an unknown value type', () => {
    const invalid = {
      category: 'Runtime',
      default: null,
      description: 'invalid entry',
      key: 'runtime.unknown',
      title: 'Unknown',
      valueType: 'colour',
    }
    expect(VALID_VALUE_TYPES.has(invalid.valueType)).toBe(false)
  })

  it('identifies registry-owned keys for the legacy settings guard', () => {
    expect(isRegistryOwnedSettingKey('runtime.eccPath')).toBe(true)
    expect(isRegistryOwnedSettingKey('runtime.eccSizerRoot')).toBe(true)
    expect(isRegistryOwnedSettingKey('agent.codexBin')).toBe(true)
    expect(isRegistryOwnedSettingKey('pdk.defaultInstallationId')).toBe(true)
    expect(isRegistryOwnedSettingKey('ui.zoomFactor')).toBe(false)
    expect(isRegistryOwnedSettingKey('project_history')).toBe(false)
  })
})
