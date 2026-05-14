import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'

describe('DrawingArea loading state copy and reset', () => {
  it('uses English copy for missing layout JSON errors', () => {
    expect(source).toContain(
      'Layout JSON path was not found. Check that get_info(layout) returns a json or info field for the current step.',
    )
    expect(source).not.toContain('未找到布局 JSON 路径')
  })

  it('clears stale loading errors before handling a stage change', () => {
    expect(source).toContain('function resetLoadingState(): void')
    expect(source).toMatch(/const handleStageChange = async[\s\S]*?resetLoadingState\(\)/)
  })

  it('treats DRC violation JSON as an optional result file', () => {
    expect(source).toContain('readOptionalProjectTextFile')
    expect(source).toMatch(/const text = await readOptionalProjectTextFile\(abs\)[\s\S]*?if \(text === null\) return/)
    expect(source).not.toContain('workspace.readProjectTextFile(abs)')
  })
})
