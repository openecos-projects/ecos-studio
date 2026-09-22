import { describe, expect, it } from 'vitest'
import { artifactDescriptor } from './backendWorkspaceDetail'

describe('artifactDescriptor', () => {
  it('exposes a timing corner without exposing the workspace-relative path', () => {
    const descriptor = artifactDescriptor({
      artifactId: 'timing-paths-sta',
      availability: 'available',
      kind: 'timing_paths',
      name: 'MAX_125/RCworst/timing_paths.json',
      reference: 'sta_ecc/feature/MAX_125/RCworst/timing_paths.json',
      sha256: 'a'.repeat(64),
      sizeBytes: 1024,
      stepId: 'sta',
    })

    expect(descriptor).toEqual({
      artifactId: 'timing-paths-sta',
      availability: 'available',
      kind: 'timing_paths',
      name: 'MAX_125/RCworst/timing_paths.json',
      sizeBytes: 1024,
      stepId: 'sta',
      timingCorner: 'MAX_125/RCworst',
    })
    expect(descriptor).not.toHaveProperty('reference')
  })

  it('derives the post-synthesis corner from the artifact reference', () => {
    expect(
      artifactDescriptor({
        artifactId: 'timing-paths-synthesis',
        availability: 'available',
        kind: 'timing_paths',
        name: 'timing_paths.json',
        reference: 'Synthesis_yosys/feature/post_synthesis/timing_paths.json',
        stepId: 'Synthesis',
      }),
    ).toMatchObject({ timingCorner: 'post_synthesis' })
  })
})
