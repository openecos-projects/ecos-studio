import { describe, expect, it } from 'vitest'
import { normalizeFrontendFilelistToken } from './frontendFilelist'

describe('normalizeFrontendFilelistToken', () => {
  it.each([
    [String.raw`C:\rtl\top.sv`, String.raw`C:\rtl\top.sv`],
    [String.raw`"C:\rtl sources\top.sv"`, String.raw`C:\rtl sources\top.sv`],
    [String.raw`'C:\rtl sources\top.sv'`, String.raw`C:\rtl sources\top.sv`],
    [String.raw`\\server\share\rtl\top.sv`, String.raw`\\server\share\rtl\top.sv`],
    [
      String.raw`"\\server\share\rtl sources\top.sv"`,
      String.raw`\\server\share\rtl sources\top.sv`,
    ],
    [String.raw`..\rtl\top.sv`, String.raw`..\rtl\top.sv`],
    [String.raw`-f "C:\rtl lists\nested.f"`, String.raw`-fC:\rtl lists\nested.f`],
    [String.raw`-fC:\rtl\nested.f`, String.raw`-fC:\rtl\nested.f`],
    [String.raw`+incdir+"C:\rtl includes\"`, '+incdir+C:\\rtl includes\\'],
    [String.raw`C:\rtl\top.sv // source`, String.raw`C:\rtl\top.sv`],
  ])('preserves Windows paths in %s', (line, expected) => {
    expect(normalizeFrontendFilelistToken(line, 'win32')).toBe(expected)
  })

  describe.each(['linux', 'darwin'] as const)('%s filelists', (platform) => {
    it.each([
      ['/rtl/top.sv', '/rtl/top.sv'],
      [String.raw`/rtl\ sources/top.sv`, '/rtl sources/top.sv'],
      ['"/rtl sources/top.sv"', '/rtl sources/top.sv'],
      ["'/rtl sources/top.sv'", '/rtl sources/top.sv'],
      [String.raw`/rtl/back\\slash.sv`, String.raw`/rtl/back\slash.sv`],
      [String.raw`"/rtl/escaped\"quote.sv"`, '/rtl/escaped"quote.sv'],
      [`'/rtl/it'"'"'s/top.sv'`, "/rtl/it's/top.sv"],
      [String.raw`-f /rtl\ lists/nested.f`, '-f/rtl lists/nested.f'],
      ['+incdir+"/rtl includes"', '+incdir+/rtl includes'],
    ])('keeps existing quoting and escapes in %s', (line, expected) => {
      expect(normalizeFrontendFilelistToken(line, platform)).toBe(expected)
    })
  })

  it('uses the host platform when none is specified', () => {
    const line = String.raw`"C:\rtl sources\top.sv"`
    const expected =
      process.platform === 'win32'
        ? String.raw`C:\rtl sources\top.sv`
        : 'C:rtl sourcestop.sv'
    expect(normalizeFrontendFilelistToken(line)).toBe(expected)
  })
})
