import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import {
  buildMacroStagingManifest,
  DefComponentScanner,
  isMacroPlacementStep,
  parseBlockMasters,
  parseDefComponents,
  readDefComponents,
  serializeMacroStagingManifest,
} from './chipViewerMacroStaging'

const MASTERS_TSV = [
  'name\ttype\tsite\tsymmetry\torigin_x\torigin_y\twidth\theight\tterm_count\tobs_count',
  'BUFX1P4H7L\tCORE\tcore7\tX,Y\t0\t0\t4800\t1400\t7\t1',
  'SRAM_64x32\tBLOCK\tsite9\tX,Y\t0\t0\t40000\t30000\t120\t0',
  'ROM_16x8\tBLOCK BLACKBOX\tsite9\tX,Y,R90\t0\t0\t12000\t8000\t40\t0',
  'ANALOG_PAD\tPAD\tpad\t\t0\t0\t20000\t20000\t16\t0',
  'SOFT_BLK\tBLOCK SOFT\tsite9\tY\t0\t0\t9000\t7000\t12\t0',
].join('\n')

function defWithComponents(components: string): string {
  return [
    'VERSION 5.8 ;',
    'DIVIDERCHAR "/" ;',
    'BUSBITCHARS "[]" ;',
    'DESIGN gcd ;',
    'UNITS',
    '  DISTANCE MICRONS 1000 ;',
    'END UNITS',
    'DIEAREA ( 0 0 ) ( 52000 53000 ) ;',
    'ROW ROW_0 core7 2000 2000 FS DO 240 BY 1 STEP 200 0 ;',
    'COMPONENTS 4 ;',
    components,
    'END COMPONENTS',
    'PINS 1 ;',
    '    - clk + NET clk + DIRECTION INPUT + FIXED ( 0 0 ) N ;',
    'END PINS',
    'END DESIGN',
  ].join('\n')
}

describe('isMacroPlacementStep', () => {
  it('matches the preFloorplan step regardless of case and spacing', () => {
    expect(isMacroPlacementStep('preFloorplan')).toBe(true)
    expect(isMacroPlacementStep(' prefloorplan ')).toBe(true)
    expect(isMacroPlacementStep('PRE_FLOORPLAN')).toBe(false)
    expect(isMacroPlacementStep('postFloorplan')).toBe(false)
  })
})

describe('readDefComponents', () => {
  it('decompresses gzip payloads detected by magic bytes regardless of suffix', async () => {
    const defText = defWithComponents('- u_rom ROM_16x8 ;')
    const gzPath = '/tmp/design.def'
    const plainPath = '/tmp/design.def.gz'
    const files = new Map([
      [gzPath, gzipSync(Buffer.from(defText, 'utf8'))],
      [plainPath, Buffer.from(defText, 'utf8')],
    ])
    const readBinaryFile = (path: string) => Promise.resolve(files.get(path)!)

    const fromGzip = await readDefComponents(gzPath, readBinaryFile)
    const fromPlain = await readDefComponents(plainPath, readBinaryFile)
    expect(fromGzip.components).toEqual([
      { name: 'u_rom', master: 'ROM_16x8', placed: false, x: 0, y: 0, orient: '' },
    ])
    expect(fromPlain).toEqual(fromGzip)
  })

  it('parses correctly when chunks split lines, tokens, and multi-byte text', async () => {
    const defText = defWithComponents(
      '    - u_sram01 SRAM_64x32 + SOURCE DIST + FIXED ( 400 800 ) FS ;\n' +
        '    - u_rom01 ROM_16x8 ;',
    )
    const encoded = Buffer.from(defText, 'utf8')
    // Feed the plain buffer in tiny slices through the streaming scanner.
    const scanner = new DefComponentScanner()
    const decoder = new TextDecoder('utf-8')
    for (let offset = 0; offset < encoded.length; offset += 7) {
      scanner.push(decoder.decode(encoded.subarray(offset, offset + 7), { stream: true }))
    }
    scanner.push(decoder.decode())
    const parsed = scanner.finish()

    expect(parsed.dbuPerMicron).toBe(1000)
    expect(parsed.dieArea).toEqual({ lx: 0, ly: 0, hx: 52000, hy: 53000 })
    expect(parsed.components).toEqual([
      {
        name: 'u_sram01',
        master: 'SRAM_64x32',
        placed: true,
        x: 400,
        y: 800,
        orient: 'FS',
      },
      { name: 'u_rom01', master: 'ROM_16x8', placed: false, x: 0, y: 0, orient: '' },
    ])
  })

  it('keeps numeric tokens intact when chunk boundaries split them', () => {
    const defText = defWithComponents('    - u_rom01 ROM_16x8 ;')
    // Slice at three-byte boundaries so numbers like 1000 and coordinates
    // are routinely split across pushes.
    const scanner = new DefComponentScanner()
    for (let offset = 0; offset < defText.length; offset += 3) {
      scanner.push(defText.slice(offset, offset + 3))
    }
    const parsed = scanner.finish()

    expect(parsed.dbuPerMicron).toBe(1000)
    expect(parsed.dieArea).toEqual({ lx: 0, ly: 0, hx: 52000, hy: 53000 })
    expect(parsed.components).toEqual([
      { name: 'u_rom01', master: 'ROM_16x8', placed: false, x: 0, y: 0, orient: '' },
    ])
  })

  it('propagates read failures', async () => {
    await expect(
      readDefComponents('/tmp/missing.def', () => Promise.reject(new Error('no file'))),
    ).rejects.toThrow('no file')
  })
})

describe('parseDefComponents', () => {
  it('parses units, die area, and unplaced components spanning lines', () => {
    const parsed = parseDefComponents(
      defWithComponents(
        [
          '    - u_rom01 ROM_16x8',
          '      + SOURCE DIST ;',
          '    - u_sram01 SRAM_64x32  ;',
          '    - ctrl.reg_p DFFQX1H7L',
          '      ;',
        ].join('\n'),
      ),
    )

    expect(parsed.dbuPerMicron).toBe(1000)
    expect(parsed.dieArea).toEqual({ lx: 0, ly: 0, hx: 52000, hy: 53000 })
    expect(parsed.components).toEqual([
      { name: 'u_rom01', master: 'ROM_16x8', placed: false, x: 0, y: 0, orient: '' },
      { name: 'u_sram01', master: 'SRAM_64x32', placed: false, x: 0, y: 0, orient: '' },
      { name: 'ctrl.reg_p', master: 'DFFQX1H7L', placed: false, x: 0, y: 0, orient: '' },
    ])
  })

  it('ignores pin entries after the components section', () => {
    const parsed = parseDefComponents(defWithComponents('    - u_rom01 ROM_16x8 ;'))

    expect(parsed.components).toHaveLength(1)
    expect(parsed.components[0].name).toBe('u_rom01')
  })

  it('dispatches several statements that share one line', () => {
    const parsed = parseDefComponents(
      [
        'VERSION 5.8 ;',
        'UNITS DISTANCE MICRONS 1000 ;',
        'COMPONENTS 2 ; - u_rom01 ROM_16x8 ; - u_rom02 ROM_16x8 ;',
        'END COMPONENTS',
      ].join('\n'),
    )

    expect(parsed.dbuPerMicron).toBe(1000)
    expect(parsed.components.map((component) => component.name)).toEqual([
      'u_rom01',
      'u_rom02',
    ])
  })

  it('parses placed and fixed components with every DEF orientation alias', () => {
    const orientations = ['N', 'W', 'S', 'E', 'FN', 'FE', 'FS', 'FW']
    const components = orientations
      .map(
        (orient, index) =>
          `    - u_macro_${index} SRAM_64x32 + FIXED ( ${1000 + index} 2000 ) ${orient} ;`,
      )
      .join('\n')
    const parsed = parseDefComponents(defWithComponents(components))

    expect(parsed.components.map((component) => component.placed)).toEqual(
      orientations.map(() => true),
    )
    expect(parsed.components.map((component) => component.orient)).toEqual(orientations)
    expect(parsed.components[3]).toEqual({
      name: 'u_macro_3',
      master: 'SRAM_64x32',
      placed: true,
      x: 1003,
      y: 2000,
      orient: 'E',
    })
  })

  it('skips unknown property groups inside component entries', () => {
    const parsed = parseDefComponents(
      defWithComponents(
        '    - u_sram01 SRAM_64x32 + SOURCE DIST + WEIGHT 12 + PLACED ( 400 800 ) N ;',
      ),
    )

    expect(parsed.components).toEqual([
      {
        name: 'u_sram01',
        master: 'SRAM_64x32',
        placed: true,
        x: 400,
        y: 800,
        orient: 'N',
      },
    ])
  })

  it('marks components with explicit UNPLACED status unplaced', () => {
    const parsed = parseDefComponents(
      defWithComponents('    - u_sram01 SRAM_64x32 + UNPLACED ;'),
    )

    expect(parsed.components[0].placed).toBe(false)
  })

  it('rejects unknown placement orientations with the instance name', () => {
    expect(() =>
      parseDefComponents(
        defWithComponents('    - u_sram01 SRAM_64x32 + PLACED ( 1 2 ) ZZ ;'),
      ),
    ).toThrow('macro staging: unknown DEF orientation for u_sram01: ZZ')
  })

  it('rejects placement statements without coordinates', () => {
    expect(() =>
      parseDefComponents(defWithComponents('    - u_sram01 SRAM_64x32 + FIXED N ;')),
    ).toThrow('macro staging: FIXED placement for u_sram01 is missing coordinates')
  })
})

describe('parseBlockMasters', () => {
  it('keeps the block master family with dimensions and symmetry', () => {
    const masters = parseBlockMasters(MASTERS_TSV)

    expect(masters.get('SRAM_64x32')).toEqual({
      widthDbu: 40000,
      heightDbu: 30000,
      symmetry: 'X,Y',
    })
    expect(masters.get('ROM_16x8')).toEqual({
      widthDbu: 12000,
      heightDbu: 8000,
      symmetry: 'X,Y,R90',
    })
    expect(masters.get('SOFT_BLK')).toEqual({
      widthDbu: 9000,
      heightDbu: 7000,
      symmetry: 'Y',
    })
    expect(masters.has('BUFX1P4H7L')).toBe(false)
    expect(masters.has('ANALOG_PAD')).toBe(false)
  })
})

describe('buildMacroStagingManifest', () => {
  it('joins DEF components with block masters in DEF order', () => {
    const manifest = buildMacroStagingManifest({
      defComponents: parseDefComponents(
        defWithComponents(
          [
            '    - ctrl.reg_p DFFQX1H7L ;',
            '    - u_rom01 ROM_16x8 ;',
            '    - u_sram01 SRAM_64x32 + FIXED ( 5000 6000 ) FS ;',
            '    - u_rom02 ROM_16x8 ;',
          ].join('\n'),
        ),
      ),
      mastersText: MASTERS_TSV,
    })

    expect(manifest.schema).toBe(1)
    expect(manifest.dbuPerMicron).toBe(1000)
    expect(manifest.dieArea).toEqual({ lx: 0, ly: 0, hx: 52000, hy: 53000 })
    expect(manifest.macros).toEqual([
      {
        name: 'u_rom01',
        master: 'ROM_16x8',
        widthDbu: 12000,
        heightDbu: 8000,
        orient: 'R0',
        placed: false,
      },
      {
        name: 'u_sram01',
        master: 'SRAM_64x32',
        widthDbu: 40000,
        heightDbu: 30000,
        orient: 'MX',
        placed: true,
      },
      {
        name: 'u_rom02',
        master: 'ROM_16x8',
        widthDbu: 12000,
        heightDbu: 8000,
        orient: 'R0',
        placed: false,
      },
    ])
  })

  it('round-trips through the serializer', () => {
    const manifest = buildMacroStagingManifest({
      defComponents: parseDefComponents(defWithComponents('    - u_rom01 ROM_16x8 ;')),
      mastersText: MASTERS_TSV,
    })

    expect(JSON.parse(serializeMacroStagingManifest(manifest))).toEqual(manifest)
  })
})
