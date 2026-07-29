import { describe, expect, it, vi } from 'vitest'
import {
  computeFlowLogCopyTooltipStyle,
  copyFlowLogText,
  flowLogCopyFeedbackFromResult,
  flowLogCopyFeedbackTooltip,
} from './homeViewFlowLogCopy'

describe('copyFlowLogText', () => {
  it('copies non-empty log text through the provided writer', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    await expect(copyFlowLogText('step log output', writeText)).resolves.toEqual({
      ok: true,
    })
    expect(writeText).toHaveBeenCalledWith('step log output')
  })

  it('returns empty when there is no text to copy', async () => {
    const writeText = vi.fn()

    await expect(copyFlowLogText('', writeText)).resolves.toEqual({
      ok: false,
      reason: 'empty',
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('returns failed when the clipboard writer rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))

    await expect(copyFlowLogText('step log output', writeText)).resolves.toEqual({
      ok: false,
      reason: 'failed',
      message: 'denied',
    })
  })
})

describe('flowLogCopyFeedbackTooltip', () => {
  it('maps feedback states to tooltip copy', () => {
    expect(flowLogCopyFeedbackTooltip(null)).toBe('Copy log text')
    expect(flowLogCopyFeedbackTooltip('copied')).toBe('Copied to clipboard')
    expect(flowLogCopyFeedbackTooltip('empty')).toBe('Nothing to copy')
    expect(flowLogCopyFeedbackTooltip('failed')).toBe('Copy failed')
  })

  it('maps copy results to feedback states', () => {
    expect(flowLogCopyFeedbackFromResult({ ok: true })).toBe('copied')
    expect(flowLogCopyFeedbackFromResult({ ok: false, reason: 'empty' })).toBe('empty')
    expect(flowLogCopyFeedbackFromResult({ ok: false, reason: 'failed' })).toBe('failed')
  })
})

describe('computeFlowLogCopyTooltipStyle', () => {
  it('right-aligns the tooltip under the trigger when space allows', () => {
    expect(
      computeFlowLogCopyTooltipStyle(
        { left: 200, right: 260, top: 100, bottom: 120 },
        { width: 800, height: 600 },
        { tooltipWidthPx: 140 },
      ),
    ).toEqual({
      left: '120px',
      top: '126px',
      placement: 'below',
    })
  })

  it('clamps the tooltip inside the viewport on narrow panels', () => {
    expect(
      computeFlowLogCopyTooltipStyle(
        { left: 10, right: 70, top: 20, bottom: 40 },
        { width: 120, height: 200 },
        { tooltipWidthPx: 140, paddingPx: 8 },
      ),
    ).toEqual({
      left: '8px',
      top: '46px',
      placement: 'below',
    })
  })

  it('places the tooltip above the trigger when there is no room below', () => {
    expect(
      computeFlowLogCopyTooltipStyle(
        { left: 200, right: 260, top: 560, bottom: 580 },
        { width: 800, height: 600 },
        { tooltipWidthPx: 140, tooltipHeightPx: 28, gapPx: 6, paddingPx: 8 },
      ),
    ).toEqual({
      left: '120px',
      top: '526px',
      placement: 'above',
    })
  })

  it('uses measured tooltip size instead of the default estimate', () => {
    expect(
      computeFlowLogCopyTooltipStyle(
        { left: 200, right: 260, top: 100, bottom: 120 },
        { width: 800, height: 600 },
        { tooltipWidthPx: 180, tooltipHeightPx: 32 },
      ),
    ).toEqual({
      left: '80px',
      top: '126px',
      placement: 'below',
    })
  })
})
