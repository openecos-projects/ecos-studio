import { describe, expect, it } from 'vitest'
import {
  buildChipViewerOpenRequest,
  canOpenChipViewer,
  chipViewerLoadingMessage,
  shouldShowChipViewer,
} from './drawingAreaChipViewer'

describe('drawing area chip viewer launch logic', () => {
  it('shows the chip viewer action only for desktop projects with a workspace step', () => {
    expect(
      shouldShowChipViewer({
        isDesktopRuntime: true,
        projectPath: '/work/gcd',
        step: 'Floorplan',
      }),
    ).toBe(true)

    expect(
      shouldShowChipViewer({
        isDesktopRuntime: false,
        projectPath: '/work/gcd',
        step: 'Floorplan',
      }),
    ).toBe(false)
    expect(
      shouldShowChipViewer({
        isDesktopRuntime: true,
        projectPath: null,
        step: 'Floorplan',
      }),
    ).toBe(false)
    expect(
      shouldShowChipViewer({
        isDesktopRuntime: true,
        projectPath: '/work/gcd',
        step: undefined,
      }),
    ).toBe(false)
  })

  it('blocks either chip viewer launch while view or edit launch is already busy', () => {
    expect(
      canOpenChipViewer({
        chipViewerBusy: false,
        chipViewerEditBusy: false,
        isDesktopRuntime: true,
        projectPath: '/work/gcd',
        step: 'route',
      }),
    ).toBe(true)

    expect(
      canOpenChipViewer({
        chipViewerBusy: true,
        chipViewerEditBusy: false,
        isDesktopRuntime: true,
        projectPath: '/work/gcd',
        step: 'route',
      }),
    ).toBe(false)
    expect(
      canOpenChipViewer({
        chipViewerBusy: false,
        chipViewerEditBusy: true,
        isDesktopRuntime: true,
        projectPath: '/work/gcd',
        step: 'route',
      }),
    ).toBe(false)
  })

  it('builds desktop open requests with the selected mode and current workspace step', () => {
    expect(buildChipViewerOpenRequest('/work/gcd', 'Floorplan', 'view')).toEqual({
      mode: 'view',
      projectPath: '/work/gcd',
      step: 'Floorplan',
    })
    expect(buildChipViewerOpenRequest('/work/gcd', 'route', 'edit')).toEqual({
      mode: 'edit',
      projectPath: '/work/gcd',
      step: 'route',
    })
  })

  it('uses different loading copy for read-only and edit launches', () => {
    expect(chipViewerLoadingMessage('view')).toBe('Opening saved Chip Viewer layout...')
    expect(chipViewerLoadingMessage('edit')).toBe('Opening editable saved layout...')
  })
})
