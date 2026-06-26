import { describe, expect, it } from 'vitest'
import {
  globalRuntimeScope,
  globalRuntimeScopeRecord,
  normalizeDirectoryScope,
  workspaceRuntimeScope,
} from './runtimeScopes'

describe('runtimeScopes', () => {
  it('normalizes workspace directory scopes', () => {
    expect(normalizeDirectoryScope(' /work/demo/ ')).toBe('/work/demo')
    expect(normalizeDirectoryScope('C:\\work\\demo\\')).toBe('C:/work/demo')
    expect(normalizeDirectoryScope('/')).toBe('/')
  })

  it('creates workspace runtime scope records', () => {
    expect(workspaceRuntimeScope(' /work/demo/ ')).toEqual({
      directory: '/work/demo',
      id: '/work/demo',
      workspaceId: '/work/demo',
    })
  })

  it('creates a global runtime scope for empty directories', () => {
    expect(workspaceRuntimeScope('   ')).toEqual({
      id: globalRuntimeScope,
    })
    expect(globalRuntimeScopeRecord()).toEqual({
      id: globalRuntimeScope,
    })
  })
})
