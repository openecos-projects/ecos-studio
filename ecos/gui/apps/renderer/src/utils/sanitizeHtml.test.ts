import { describe, expect, it } from 'vitest'
import { sanitizeClassList, sanitizeHtml, sanitizeUrl } from './sanitizeHtml'

describe('sanitizeHtml helpers', () => {
  it('rejects executable or html data URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)', 'href')).toBeNull()
    expect(sanitizeUrl(' JaVaScRiPt:alert(1)', 'href')).toBeNull()
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>', 'src')).toBeNull()
    expect(sanitizeUrl('vbscript:msgbox(1)', 'href')).toBeNull()
  })

  it('keeps safe URLs and image data URLs', () => {
    expect(sanitizeUrl('https://example.com/report', 'href')).toBe('https://example.com/report')
    expect(sanitizeUrl('/tmp/report.html', 'href')).toBe('/tmp/report.html')
    expect(sanitizeUrl('data:image/png;base64,AAAA', 'src')).toBe('data:image/png;base64,AAAA')
  })

  it('drops suspicious class tokens', () => {
    expect(sanitizeClassList('ok danger<script bad_token good:one')).toBe('ok bad_token good:one')
  })

  it('escapes raw html when DOMParser is unavailable', () => {
    expect(sanitizeHtml('<img src=x onerror=alert(1)><script>alert(2)</script>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(2)&lt;/script&gt;'
    )
  })
})
