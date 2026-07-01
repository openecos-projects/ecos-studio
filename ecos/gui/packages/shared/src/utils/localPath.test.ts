import { describe, expect, it } from 'vitest'

import {
  isAbsoluteLocalPath,
  isWindowsDrivePath,
  joinLocalPath,
  LocalPathOutsideRootError,
  normalizeLocalPath,
  resolveContainedLocalPath,
  resolveProjectFileAbsolutePath,
} from './localPath.ts'

describe('local path helpers', () => {
  it.each([
    ['C:\\Users\\ecos', true],
    ['D:/projects/chip', true],
    ['/home/ecos', false],
    ['relative/path', false],
  ])('detects Windows drive path %s', (path, expected) => {
    expect(isWindowsDrivePath(path)).toBe(expected)
  })

  it.each([
    ['/home/ecos', true],
    ['\\network\\share', true],
    ['C:\\Users\\ecos', true],
    ['D:/projects/chip', true],
    ['relative/path', false],
  ])('detects absolute local path %s', (path, expected) => {
    expect(isAbsoluteLocalPath(path)).toBe(expected)
  })

  it.each([
    ['foo//bar/./baz', 'foo/bar/baz'],
    ['foo/bar/../baz', 'foo/baz'],
    ['/home//ecos/../chip', '/home/chip'],
    ['C:/Users/ecos/../chip', 'C:\\Users\\chip'],
    ['C:\\Users\\ecos\\.\\chip', 'C:\\Users\\ecos\\chip'],
    ['\\\\server\\share\\..\\chip', '\\\\server\\chip'],
  ])('normalizes %s to %s', (path, expected) => {
    expect(normalizeLocalPath(path)).toBe(expected)
  })

  it.each([
    ['/home/ecos/project', 'rtl/top.v', '/home/ecos/project/rtl/top.v'],
    ['/home/ecos/project/', '/rtl/top.v', '/home/ecos/project/rtl/top.v'],
    ['C:\\Users\\ecos\\project', 'rtl/top.v', 'C:\\Users\\ecos\\project\\rtl\\top.v'],
  ])('joins %s and %s', (basePath, relativePath, expected) => {
    expect(joinLocalPath(basePath, relativePath)).toBe(expected)
  })

  it('resolves relative project file paths inside the project root', () => {
    expect(
      resolveProjectFileAbsolutePath('/home/ecos/project', 'runs/route/layout.json'),
    ).toBe('/home/ecos/project/runs/route/layout.json')
  })

  it('normalizes absolute project file paths without prefixing the project root', () => {
    expect(resolveProjectFileAbsolutePath('/home/ecos/project', '/tmp/layout.json')).toBe(
      '/tmp/layout.json',
    )
  })

  it.each([
    ['home/ecos/project/layout.json', '/home/ecos/project/layout.json'],
    ['Users/ecos/project/layout.json', '/Users/ecos/project/layout.json'],
  ])('recovers missing leading slash for %s', (inputPath, expected) => {
    expect(resolveProjectFileAbsolutePath('/workspace', inputPath)).toBe(expected)
  })

  it('throws for empty project file paths', () => {
    expect(() => resolveProjectFileAbsolutePath('/workspace', '   ')).toThrow(
      '布局 JSON 路径为空',
    )
  })

  it('resolves contained relative paths', () => {
    expect(resolveContainedLocalPath('/home/ecos/project', 'logs/run.log')).toBe(
      '/home/ecos/project/logs/run.log',
    )
  })

  it.each(['../outside.txt', '/tmp/outside.txt', ''])(
    'rejects path outside the root: %s',
    (relativePath) => {
      expect(() => resolveContainedLocalPath('/home/ecos/project', relativePath)).toThrow(
        LocalPathOutsideRootError,
      )
    },
  )
})
