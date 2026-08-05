import { describe, expect, it } from 'vitest'

import { desktopApiEventChannels, desktopApiIpcChannels } from './ipcChannels.ts'

function valuesOf(record: Record<string, string>): string[] {
  return Object.values(record)
}

describe('desktop IPC channel constants', () => {
  it('keeps IPC channel values unique', () => {
    const values = valuesOf(desktopApiIpcChannels)
    expect(new Set(values).size).toBe(values.length)
  })

  it('keeps event channel values unique', () => {
    const values = valuesOf(desktopApiEventChannels)
    expect(new Set(values).size).toBe(values.length)
  })

  it('uses namespaced channel values', () => {
    const values = [
      ...valuesOf(desktopApiIpcChannels),
      ...valuesOf(desktopApiEventChannels),
    ]

    expect(values).not.toHaveLength(0)
    for (const value of values) {
      expect(value).toMatch(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/)
    }
  })

  it('defines a chip viewer launch channel', () => {
    expect(desktopApiIpcChannels.chipViewerOpen).toBe('chip-viewer:open')
  })
})
