import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'FlowRunControl.vue'),
  'utf8',
)

describe('FlowRunControl Agent capture', () => {
  it('starts the flow without owning Agent artifact capture', () => {
    expect(source).not.toContain('startFlowRunArtifactCapture')
    expect(source).not.toContain('useFlowRunArtifacts')
  })
})
