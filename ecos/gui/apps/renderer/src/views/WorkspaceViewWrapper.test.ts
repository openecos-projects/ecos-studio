import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'WorkspaceViewWrapper.vue'),
  'utf8',
)

describe('WorkspaceViewWrapper Agent capture', () => {
  it('keeps GUI flow capture on the workspace shell instead of step pages', () => {
    expect(source).toContain('useWorkspaceAgentFlowCapture()')
  })
})
