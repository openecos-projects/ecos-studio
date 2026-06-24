import {
  LocalPathOutsideRootError,
  resolveContainedLocalPath,
  resolveProjectFileAbsolutePath,
} from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'

describe('resolveProjectFileAbsolutePath', () => {
  it('joins project-relative layout paths onto the project root', () => {
    expect(resolveProjectFileAbsolutePath('/tmp/project', './steps/layout.json')).toBe(
      '/tmp/project/steps/layout.json',
    )
  })

  it('repairs bare Users/ absolute paths from persisted layout locations', () => {
    expect(resolveProjectFileAbsolutePath('/tmp/project', 'Users/alice/layout.json')).toBe(
      '/Users/alice/layout.json',
    )
  })
})

describe('resolveContainedLocalPath', () => {
  it('resolves project resource paths inside the allowed root', () => {
    expect(
      resolveContainedLocalPath('/tmp/project', 'output/preview.bin'),
    ).toBe('/tmp/project/output/preview.bin')
  })

  it('rejects escape attempts outside the allowed root', () => {
    expect(() => resolveContainedLocalPath('/tmp/project', '../secrets.txt')).toThrow(
      LocalPathOutsideRootError,
    )
  })
})
