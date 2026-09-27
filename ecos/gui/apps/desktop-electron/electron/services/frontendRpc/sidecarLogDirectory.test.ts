import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveEccSidecarLogDirectory } from './sidecarLogDirectory'

describe('resolveEccSidecarLogDirectory', () => {
  it('uses the desktop log session instead of a workspace path', () => {
    const sessionDirectory = '/app-data/logs/sessions/20260807-104000-1234'

    expect(resolveEccSidecarLogDirectory(sessionDirectory)).toBe(
      join(sessionDirectory, 'ecc-rpc'),
    )
  })
})
