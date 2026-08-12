import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPathWithinRoot, isRelativePathOutsideRoot } from './pathScope'

describe('pathScope', () => {
  it('distinguishes a parent traversal segment from a child beginning with dots', () => {
    expect(isRelativePathOutsideRoot('..')).toBe(true)
    expect(isRelativePathOutsideRoot(join('..', 'outside'))).toBe(true)
    expect(isRelativePathOutsideRoot('..ws_0001.replace-backup-1')).toBe(false)
  })

  it('allows dot-prefixed backup children while rejecting sibling paths', () => {
    const root = join('/tmp', 'project')

    expect(isPathWithinRoot(join(root, '..ws_0001.replace-backup-1'), root)).toBe(true)
    expect(isPathWithinRoot(join('/tmp', 'project-other'), root)).toBe(false)
  })
})
