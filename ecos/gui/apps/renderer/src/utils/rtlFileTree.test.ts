import { describe, expect, it } from 'vitest'
import { buildRtlFileTree, filterRtlTreeFiles } from './rtlFileTree'

describe('rtlFileTree', () => {
  it('builds a nested tree from absolute file paths', () => {
    const rootPath = '/design/chip'
    const files = [
      '/design/chip/src/top.v',
      '/design/chip/src/core/alu.sv',
      '/design/chip/rtl/mem.vhd',
    ]

    const tree = buildRtlFileTree(rootPath, files)

    expect(tree.name).toBe('chip')
    expect(tree.children.map((node) => node.name)).toEqual(['rtl', 'src'])
    expect(tree.children.find((node) => node.name === 'src')?.children.map((node) => node.name))
      .toEqual(['core', 'top.v'])
  })

  it('filters the tree down to the provided file paths', () => {
    const rootPath = '/design/chip'
    const files = [
      '/design/chip/src/top.v',
      '/design/chip/src/core/alu.sv',
    ]
    const tree = buildRtlFileTree(rootPath, files)
    const filtered = filterRtlTreeFiles(tree, ['/design/chip/src/top.v'])

    expect(filtered.children).toEqual([
      expect.objectContaining({
        name: 'src',
        children: [
          expect.objectContaining({ name: 'top.v', kind: 'file' }),
        ],
      }),
    ])
  })
})
