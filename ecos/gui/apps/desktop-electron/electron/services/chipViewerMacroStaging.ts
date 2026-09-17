import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'

/**
 * Macro staging support for the chip viewer layout edit session.
 *
 * After preFloorplan every instance is unplaced, and the geometry snapshot
 * skips unplaced instances. This module rebuilds the block-macro inventory
 * from two existing artifacts so the viewer can stage unplaced macros next
 * to the die: the step DEF (instance names, masters, placements) and the
 * geometry snapshot master metadata (block master sizes).
 *
 * Step DEFs easily exceed the V8 maximum string length, so the DEF is
 * scanned as a statement stream instead of one decoded string.
 */

/** Steps whose layout edit session is the manual macro-placement entry point. */
const MACRO_PLACEMENT_STEPS = ['prefloorplan']

/** DEF orientation names mapped to the R-notation shared with ECC Tcl. */
export const DEF_TO_R_ORIENT: Record<string, string> = {
  N: 'R0',
  W: 'R90',
  S: 'R180',
  E: 'R270',
  FN: 'MY',
  FE: 'MY90',
  FS: 'MX',
  FW: 'MX90',
}

export interface DefComponent {
  name: string
  master: string
  placed: boolean
  x: number
  y: number
  /** Raw DEF orientation token (N/W/S/E/FN/FE/FS/FW) when placed. */
  orient: string
}

export interface DefComponents {
  dbuPerMicron: number | null
  dieArea: { lx: number; ly: number; hx: number; hy: number } | null
  components: DefComponent[]
}

export interface BlockMaster {
  widthDbu: number
  heightDbu: number
  symmetry: string
}

export interface MacroStagingEntry {
  name: string
  master: string
  widthDbu: number
  heightDbu: number
  /** R-notation orientation; R0 for unplaced macros. */
  orient: string
  placed: boolean
}

export interface MacroStagingManifest {
  schema: 1
  dbuPerMicron: number | null
  dieArea: { lx: number; ly: number; hx: number; hy: number } | null
  macros: MacroStagingEntry[]
}

export type ReadBinaryFile = (path: string) => Promise<Buffer>

export function isMacroPlacementStep(step: string): boolean {
  return MACRO_PLACEMENT_STEPS.includes(step.trim().toLowerCase())
}

/**
 * Splits DEF text into whitespace-separated tokens, keeping '(' ')' ';'
 * separate so statements can be scanned positionally.
 */
function tokenizeDef(text: string): string[] {
  const tokens: string[] = []
  for (const chunk of text.split(/\s+/)) {
    if (!chunk) continue
    const parts = chunk.replace(/[(;]/g, ' $& ').replace(/[)]/g, ' $& ').split(/\s+/)
    for (const part of parts) {
      if (part) tokens.push(part)
    }
  }
  return tokens
}

function tokenToNumber(token: string, context: string): number {
  const value = Number(token)
  if (!Number.isFinite(value)) {
    throw new Error(`macro staging: invalid ${context} value: ${token}`)
  }
  return value
}

/**
 * Incremental DEF scanner. Lines accumulate into `;`-terminated statements
 * that are dispatched one at a time, so the DEF never has to exist as a
 * single string. Everything after `END COMPONENTS` is discarded: the macro
 * inventory only needs the header and the COMPONENTS section.
 */
export class DefComponentScanner {
  private readonly result: DefComponents = {
    dbuPerMicron: null,
    dieArea: null,
    components: [],
  }
  /** Completed lines of the current statement, joined with single spaces. */
  private lines = ''
  /** In-flight line fragment carried across chunk boundaries. Appended
   * verbatim so chunk splits never inject characters into a token. */
  private partial = ''
  private inComponents = false
  private finished = false

  push(chunk: string): void {
    let start = 0
    for (let index = 0; index < chunk.length; index += 1) {
      if (this.finished) return
      if (chunk.charCodeAt(index) === 10) {
        this.completeLine(chunk.slice(start, index))
        start = index + 1
      }
    }
    if (!this.finished) {
      this.partial += chunk.slice(start)
    }
  }

  finish(): DefComponents {
    if (!this.finished && this.partial.trim()) {
      this.completeLine('')
    }
    this.finished = true
    this.lines = ''
    this.partial = ''
    return this.result
  }

  private completeLine(fragment: string): void {
    if (this.finished) return
    const line = (this.partial + fragment).trim()
    this.partial = ''
    if (!line) return
    this.lines += (this.lines ? ' ' : '') + line
    // DEF allows several `;`-terminated statements on one line; dispatch
    // each one as soon as its terminating semicolon arrives.
    while (!this.finished) {
      const separator = this.lines.indexOf(';')
      if (separator < 0) break
      const statement = this.lines.slice(0, separator + 1)
      this.lines = this.lines.slice(separator + 1)
      this.processStatement(statement)
    }
    const remainder = this.lines.trim()
    if (!remainder) {
      this.lines = ''
      return
    }
    // Statement trailers such as `END COMPONENTS` or `END UNITS` carry no
    // semicolon; drop them so they never merge into the next statement.
    if (/^END\s/.test(remainder)) {
      if (/^END\s+COMPONENTS\b/.test(remainder)) {
        // The macro inventory is complete; discard the rest of the file.
        this.inComponents = false
        this.finished = true
      }
      this.lines = ''
    }
  }

  private processStatement(statement: string): void {
    const tokens = tokenizeDef(statement)
    if (tokens[0] === 'COMPONENTS') {
      this.inComponents = true
      return
    }
    if (!this.inComponents) {
      if (tokens[0] === 'UNITS' && tokens[1] === 'DISTANCE' && tokens[2] === 'MICRONS') {
        this.result.dbuPerMicron = tokenToNumber(tokens[3], 'UNITS DISTANCE MICRONS')
      } else if (tokens[0] === 'DIEAREA' && tokens[1] === '(') {
        this.result.dieArea = parseDieArea(tokens)
      }
      return
    }
    if (tokens[0] === '-') {
      this.result.components.push(parseComponentEntry(tokens))
    }
  }
}

function parseDieArea(tokens: string[]): DefComponents['dieArea'] {
  const coords: number[] = []
  for (const token of tokens.slice(1)) {
    if (token !== '(' && token !== ')' && token !== ';') {
      coords.push(tokenToNumber(token, 'DIEAREA coordinate'))
    }
  }
  if (coords.length < 4) {
    throw new Error('macro staging: DIEAREA statement has fewer than four coordinates')
  }
  return {
    lx: Math.min(coords[0], coords[2]),
    ly: Math.min(coords[1], coords[3]),
    hx: Math.max(coords[0], coords[2]),
    hy: Math.max(coords[1], coords[3]),
  }
}

/** Parses one `- name master [+ PLACED ( x y ) orient] ;` component entry. */
function parseComponentEntry(tokens: string[]): DefComponent {
  const name = tokens[1]
  const master = tokens[2]
  if (
    !name ||
    !master ||
    name === '+' ||
    name === ';' ||
    master === '+' ||
    master === ';'
  ) {
    throw new Error(`macro staging: malformed COMPONENTS entry: ${tokens.join(' ')}`)
  }
  const component: DefComponent = { name, master, placed: false, x: 0, y: 0, orient: '' }

  let index = 3
  while (index < tokens.length && tokens[index] !== ';') {
    const token = tokens[index]
    if (token !== '+') {
      index += 1
      continue
    }
    const property = tokens[index + 1]
    if (property === 'PLACED' || property === 'FIXED' || property === 'COVER') {
      if (tokens[index + 2] !== '(') {
        throw new Error(
          `macro staging: ${property} placement for ${name} is missing coordinates`,
        )
      }
      component.x = tokenToNumber(tokens[index + 3], `${property} x`)
      component.y = tokenToNumber(tokens[index + 4], `${property} y`)
      const closeParen = tokens[index + 5]
      const orient = tokens[index + 6]
      if (closeParen !== ')' || orient === undefined || orient === ';') {
        throw new Error(
          `macro staging: ${property} placement for ${name} is missing its orientation`,
        )
      }
      if (!(orient.toUpperCase() in DEF_TO_R_ORIENT)) {
        throw new Error(`macro staging: unknown DEF orientation for ${name}: ${orient}`)
      }
      component.placed = true
      component.orient = orient.toUpperCase()
      index += 7
      continue
    }
    if (property === 'UNPLACED') {
      component.placed = false
      component.orient = ''
      index += 2
      continue
    }
    // Unknown property group: skip its arguments until the next group or the
    // end of the statement.
    index += 2
    while (index < tokens.length && tokens[index] !== ';' && tokens[index] !== '+') {
      index += 1
    }
  }
  return component
}

export function parseDefComponents(defText: string): DefComponents {
  const scanner = new DefComponentScanner()
  scanner.push(defText)
  return scanner.finish()
}

/**
 * Streams a DEF file (gzip detected by magic bytes, not suffix) through the
 * statement scanner. Chunked decoding keeps the working set small even for
 * multi-hundred-megabyte decompressed DEFs.
 */
export async function readDefComponents(
  path: string,
  readBinaryFile: ReadBinaryFile,
): Promise<DefComponents> {
  const buffer = await readBinaryFile(path)
  const scanner = new DefComponentScanner()
  const decoder = new TextDecoder('utf-8')
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    const gunzip = createGunzip()
    Readable.from(buffer).pipe(gunzip)
    for await (const chunk of gunzip) {
      scanner.push(decoder.decode(chunk as Buffer, { stream: true }))
    }
  } else {
    for (let offset = 0; offset < buffer.length; offset += 1 << 20) {
      scanner.push(
        decoder.decode(buffer.subarray(offset, offset + (1 << 20)), { stream: true }),
      )
    }
  }
  scanner.push(decoder.decode())
  return scanner.finish()
}

/**
 * Parses geometry `geometry.masters.txt` TSV metadata and keeps only block
 * family masters (BLOCK, BLOCK BLACKBOX, BLOCK SOFT) with numeric sizes.
 */
export function parseBlockMasters(mastersText: string): Map<string, BlockMaster> {
  const masters = new Map<string, BlockMaster>()
  const lines = mastersText.split(/\r?\n/)
  for (const [lineIndex, line] of lines.entries()) {
    if (!line.trim() || lineIndex === 0) {
      continue
    }
    const columns = line.split('\t')
    const [name, type, , symmetry, , , width, height] = columns
    if (!name || !type) {
      continue
    }
    if (!type.trim().toUpperCase().startsWith('BLOCK')) {
      continue
    }
    const widthDbu = Number(width)
    const heightDbu = Number(height)
    if (!Number.isFinite(widthDbu) || !Number.isFinite(heightDbu)) {
      throw new Error(`macro staging: block master ${name} has non-numeric dimensions`)
    }
    masters.set(name, {
      widthDbu,
      heightDbu,
      symmetry: (symmetry ?? '').trim(),
    })
  }
  return masters
}

/**
 * Joins DEF components with block master metadata into the staging manifest
 * consumed by the native viewer. Macros keep their DEF order.
 */
export function buildMacroStagingManifest(input: {
  defComponents: DefComponents
  mastersText: string
}): MacroStagingManifest {
  const parsed = input.defComponents
  const blockMasters = parseBlockMasters(input.mastersText)
  const macros: MacroStagingEntry[] = []
  for (const component of parsed.components) {
    const master = blockMasters.get(component.master)
    if (!master) {
      continue
    }
    const orient = component.placed ? DEF_TO_R_ORIENT[component.orient] : 'R0'
    macros.push({
      name: component.name,
      master: component.master,
      widthDbu: master.widthDbu,
      heightDbu: master.heightDbu,
      orient,
      placed: component.placed,
    })
  }
  return {
    schema: 1,
    dbuPerMicron: parsed.dbuPerMicron,
    dieArea: parsed.dieArea,
    macros,
  }
}

export function serializeMacroStagingManifest(manifest: MacroStagingManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
