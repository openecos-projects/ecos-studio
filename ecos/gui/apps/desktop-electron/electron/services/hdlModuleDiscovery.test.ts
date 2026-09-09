import { gzipSync } from 'node:zlib'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_HDL_MODULE_DISCOVERY_BOUNDS,
  discoverHdlModules,
} from './hdlModuleDiscovery'

describe('discoverHdlModules', () => {
  let tempRoot = ''

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = ''
    }
  })

  it('collects unique module and macromodule names from RTL, including ifdef branches', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-'))
    const top = join(tempRoot, 'top.v')
    const child = join(tempRoot, 'child.sv')
    await writeFile(
      top,
      `
        (* keep *) module gcd (
          input clk
        );
          Foo u_foo (
            .clk(clk)
          );
        endmodule
        \`ifdef USE_ALT
        macromodule AltTop;
        endmacromodule
        \`endif
        // module CommentedOut
        /* module BlockedOut */
        interface bus_if;
        endinterface
        package pkg;
        endpackage
      `,
    )
    await writeFile(
      child,
      `
        module Foo;
        endmodule
        module gcd;
        endmodule
      `,
    )

    const result = await discoverHdlModules({
      rtlPaths: [top, child],
      designName: 'gcd',
    })

    expect(result.status).toBe('complete')
    expect(result.candidates).toEqual(['gcd', 'AltTop', 'Foo'])
    expect(result.suggested).toBe('gcd')
    expect(result.reason).toBeUndefined()
  })

  it('decompresses gzip HDL before parsing', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-gz-'))
    const gzPath = join(tempRoot, 'top.v.gz')
    await writeFile(gzPath, gzipSync(Buffer.from('module GzipTop;\nendmodule\n')))

    const result = await discoverHdlModules({
      rtlPaths: [gzPath],
      designName: 'GzipTop',
    })

    expect(result.status).toBe('complete')
    expect(result.candidates).toEqual(['GzipTop'])
    expect(result.suggested).toBe('GzipTop')
  })

  it('expands filelist HDL paths without nested -f -v -y', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-f-'))
    const nested = join(tempRoot, 'nested.f')
    const listed = join(tempRoot, 'listed.v')
    const ignoredNested = join(tempRoot, 'ignored.v')
    const filelist = join(tempRoot, 'sources.f')
    await writeFile(ignoredNested, 'module NestedTop;\nendmodule\n')
    await writeFile(listed, 'module ListedTop;\nendmodule\n')
    await writeFile(nested, `${ignoredNested}\n`)
    await writeFile(
      filelist,
      `
        ${listed}
        -f ${nested}
        -v /lib/cells.v
        -y /lib
      `,
    )

    const result = await discoverHdlModules({
      filelistPath: filelist,
      designName: 'ListedTop',
    })

    expect(result.status).toBe('complete')
    expect(result.candidates).toEqual(['ListedTop'])
  })

  it('treats parameterized instances as instantiations of discovered modules', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-param-'))
    const rtl = join(tempRoot, 'design.v')
    await writeFile(
      rtl,
      `
        module child;
        endmodule
        module parent;
          child #(
            .W(8)
          ) u_child (
            .clk(clk)
          );
        endmodule
      `,
    )

    const result = await discoverHdlModules({
      rtlPaths: [rtl],
      designName: 'other',
    })

    expect(result.suggested).toBe('parent')
  })

  it('ranks an uninstantiated discovered module over an instantiated child', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-rank-'))
    const top = join(tempRoot, 'design.v')
    await writeFile(
      top,
      `
        module child;
        endmodule
        module parent;
          child u_child (
            .clk(clk)
          );
        endmodule
      `,
    )

    const result = await discoverHdlModules({
      rtlPaths: [top],
      designName: 'other',
    })

    expect(result.status).toBe('complete')
    expect(result.candidates).toEqual(['child', 'parent'])
    expect(result.suggested).toBe('parent')
  })

  it('keeps source workspace top when it is still present', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-source-'))
    const netlist = join(tempRoot, 'netlist.v')
    await writeFile(
      netlist,
      `
        module gcd_top;
        endmodule
        module leftover;
        endmodule
      `,
    )

    const result = await discoverHdlModules({
      originVerilogPath: netlist,
      designName: 'leftover',
      sourceTopModule: 'gcd_top',
      manifestTopModule: 'leftover',
    })

    expect(result.suggested).toBe('gcd_top')
  })

  it('matches heuristic identifiers case-sensitively', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-case-'))
    const rtl = join(tempRoot, 'top.v')
    await writeFile(rtl, 'module Gcd;\nendmodule\nmodule other;\nendmodule\n')

    const result = await discoverHdlModules({
      rtlPaths: [rtl],
      designName: 'gcd',
      manifestTopModule: 'gcd',
    })

    expect(result.candidates).toEqual(['Gcd', 'other'])
    expect(result.suggested).toBe('Gcd')
  })

  it('fails closed on partial read failure without a truncated list', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-partial-'))
    const readable = join(tempRoot, 'ok.v')
    const missing = join(tempRoot, 'missing.v')
    await writeFile(readable, 'module ok;\nendmodule\n')

    const result = await discoverHdlModules({
      rtlPaths: [readable, missing],
      designName: 'ok',
    })

    expect(result).toMatchObject({
      status: 'partial_read_failure',
      candidates: [],
      suggested: '',
    })
    expect(result.reason).toMatch(/could not be read/i)
  })

  it('allows incomplete discovery when a bound is hit instead of returning a truncated list', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-bound-'))
    const first = join(tempRoot, 'a.v')
    const second = join(tempRoot, 'b.v')
    await writeFile(first, 'module first;\nendmodule\n')
    await writeFile(second, 'module second;\nendmodule\n')

    const result = await discoverHdlModules(
      {
        rtlPaths: [first, second],
        designName: 'first',
      },
      { ...DEFAULT_HDL_MODULE_DISCOVERY_BOUNDS, maxFiles: 1 },
    )

    expect(result.status).toBe('incomplete')
    expect(result.candidates).toEqual([])
    expect(result.suggested).toBe('')
    expect(result.reason).toMatch(/too large|did not finish|bound/i)
  })

  it('rejects mixed RTL and filelist discovery sets', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-mixed-'))
    const rtl = join(tempRoot, 'top.v')
    const filelist = join(tempRoot, 'sources.f')
    await writeFile(rtl, 'module MixedTop;\nendmodule\n')
    await writeFile(filelist, `${rtl}\n`)

    const result = await discoverHdlModules({
      rtlPaths: [rtl],
      filelistPath: filelist,
      designName: 'MixedTop',
    })

    expect(result.status).toBe('incomplete')
    expect(result.candidates).toEqual([])
    expect(result.reason).toMatch(/exactly one/i)
  })

  it('reports total read failure when every HDL path is unreadable', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'hdl-discover-all-'))
    const missing = join(tempRoot, 'gone.v')

    const result = await discoverHdlModules({
      rtlPaths: [missing],
      designName: 'gone',
    })

    expect(result.status).toBe('total_read_failure')
    expect(result.candidates).toEqual([])
    expect(result.reason).toMatch(/unreadable/i)
  })
})
