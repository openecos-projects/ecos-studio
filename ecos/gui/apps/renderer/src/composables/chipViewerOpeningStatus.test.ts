import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginChipViewerOpening,
  useChipViewerOpeningStatus,
} from './chipViewerOpeningStatus'

describe('Chip Viewer opening status', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('tracks the most recent launch and restores an earlier pending launch', () => {
    const status = useChipViewerOpeningStatus()
    const first = beginChipViewerOpening('Opening saved layout', 'place')
    const second = beginChipViewerOpening('Opening editable layout', 'macro placement')

    expect(status.value).toMatchObject({
      detail: 'macro placement',
      message: 'Opening editable layout',
      phase: 'opening',
    })

    second.finish()
    expect(status.value).toMatchObject({
      message: 'Opening saved layout',
      phase: 'opening',
    })
    first.finish()
    expect(status.value).toBeNull()
  })

  it('updates through preparation, launch, and a short started confirmation', () => {
    const status = useChipViewerOpeningStatus()
    const opening = beginChipViewerOpening('Preparing DEF layout', 'selected file')
    opening.update('Opening Chip Viewer', 'DEF View')
    expect(status.value).toMatchObject({
      detail: 'DEF View',
      message: 'Opening Chip Viewer',
      phase: 'opening',
    })

    opening.complete()
    expect(status.value).toMatchObject({
      message: 'Chip Viewer started',
      phase: 'started',
    })
    vi.advanceTimersByTime(1399)
    expect(status.value).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(status.value).toBeNull()
  })
})
