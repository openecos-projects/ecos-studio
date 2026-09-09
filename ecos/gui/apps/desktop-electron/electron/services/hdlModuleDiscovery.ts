import { gunzipSync } from 'node:zlib'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import {
  isHdlFilePath,
  normalizeLocalPath,
  type HdlModuleDiscoveryRequest,
  type HdlModuleDiscoveryResult,
} from '@ecos-studio/shared'
import { parseFilelistContent, resolveFilelistPath } from './designFilelist'

export const DEFAULT_HDL_MODULE_DISCOVERY_BOUNDS = {
  maxFiles: 256,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  timeoutMs: 8_000,
}

export type HdlModuleDiscoveryBounds = typeof DEFAULT_HDL_MODULE_DISCOVERY_BOUNDS

const MODULE_DECLARATION =
  /(?:\(\*[\s\S]*?\*\))?\s*\b(?:macromodule|module)\s+([A-Za-z_][A-Za-z0-9_$]*)\b/g
const END_MODULE = /\b(?:endmodule|endmacromodule)\b/g
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/
const TESTBENCH_NAME = /(?:^tb_)|(?:_tb$)|(?:_test$)/i

export async function discoverHdlModules(
  request: HdlModuleDiscoveryRequest,
  bounds: HdlModuleDiscoveryBounds = DEFAULT_HDL_MODULE_DISCOVERY_BOUNDS,
): Promise<HdlModuleDiscoveryResult> {
  const startedAt = Date.now()
  const sourcePaths = await resolveDiscoveryPaths(request, bounds)
  if (sourcePaths.status !== 'ok') return sourcePaths.result
  if (sourcePaths.paths.length === 0) {
    return { status: 'complete', candidates: [], suggested: '' }
  }
  if (sourcePaths.paths.length > bounds.maxFiles) {
    return incompleteResult('The selected HDL set is too large to scan completely.')
  }

  const texts: { path: string; text: string }[] = []
  let readFailures = 0
  let totalBytes = 0

  for (const path of sourcePaths.paths) {
    if (Date.now() - startedAt > bounds.timeoutMs) {
      return incompleteResult('HDL discovery did not finish before the time limit.')
    }
    const read = await readDiscoveryFile(path, bounds, totalBytes)
    if (read.kind === 'incomplete') return incompleteResult(read.reason)
    if (read.kind === 'failure') {
      readFailures += 1
      continue
    }
    totalBytes += read.bytes
    texts.push({ path, text: read.text })
  }

  if (sourcePaths.paths.length > 0 && readFailures === sourcePaths.paths.length) {
    return {
      status: 'total_read_failure',
      candidates: [],
      suggested: '',
      reason: 'Every selected HDL path is unreadable.',
    }
  }
  if (readFailures > 0) {
    return {
      status: 'partial_read_failure',
      candidates: [],
      suggested: '',
      reason: 'One or more selected HDL files could not be read.',
    }
  }

  const modules = collectDeclaredModules(texts.map((entry) => entry.text).join('\n'))
  const candidates = [...new Set(modules.names)]
  const suggested = rankSuggestedModule({
    candidates,
    designName: request.designName?.trim() ?? '',
    manifestTopModule: request.manifestTopModule?.trim() || undefined,
    sourceTopModule: request.sourceTopModule?.trim() || undefined,
    instantiated: modules.instantiated,
    fileStems: sourcePaths.paths.map(hdlFileStem),
  })
  return {
    status: 'complete',
    candidates,
    suggested,
  }
}

async function resolveDiscoveryPaths(
  request: HdlModuleDiscoveryRequest,
  bounds: HdlModuleDiscoveryBounds,
): Promise<
  | { status: 'ok'; paths: string[] }
  | { status: 'error'; result: HdlModuleDiscoveryResult }
> {
  const filelistPath = request.filelistPath?.trim() ?? ''
  const originVerilogPath = request.originVerilogPath?.trim() ?? ''
  const rtlPaths = (request.rtlPaths ?? [])
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => normalizeLocalPath(path))
  if (
    (filelistPath && originVerilogPath) ||
    (filelistPath && rtlPaths.length > 0) ||
    (originVerilogPath && rtlPaths.length > 0)
  ) {
    return {
      status: 'error',
      result: {
        status: 'incomplete',
        candidates: [],
        suggested: '',
        reason: 'HDL discovery requires exactly one of RTL, filelist, or origin Verilog.',
      },
    }
  }
  if (filelistPath) {
    const expanded = await expandFilelistHdlPaths(filelistPath, bounds)
    if (expanded.status !== 'ok') return expanded
    return { status: 'ok', paths: uniquePaths(expanded.paths) }
  }
  if (originVerilogPath) {
    return { status: 'ok', paths: [normalizeLocalPath(originVerilogPath)] }
  }
  return { status: 'ok', paths: uniquePaths(rtlPaths) }
}

async function expandFilelistHdlPaths(
  filelistPath: string,
  bounds: HdlModuleDiscoveryBounds,
): Promise<
  | { status: 'ok'; paths: string[] }
  | { status: 'error'; result: HdlModuleDiscoveryResult }
> {
  const read = await readDiscoveryFile(filelistPath, bounds, 0)
  if (read.kind === 'incomplete') {
    return { status: 'error', result: incompleteResult(read.reason) }
  }
  if (read.kind === 'failure') {
    return {
      status: 'error',
      result: {
        status: 'total_read_failure',
        candidates: [],
        suggested: '',
        reason: 'Every selected HDL path is unreadable.',
      },
    }
  }

  const filelistDir = dirname(filelistPath)
  const paths: string[] = []
  for (const line of parseFilelistContent(read.text)) {
    if (line.kind !== 'file') continue
    const resolved = resolveFilelistPath(line.path, filelistDir)
    if (!isHdlFilePath(resolved)) continue
    paths.push(normalizeLocalPath(resolved))
  }
  return { status: 'ok', paths }
}

async function readDiscoveryFile(
  path: string,
  bounds: HdlModuleDiscoveryBounds,
  totalBytes: number,
): Promise<
  | { kind: 'ok'; text: string; bytes: number }
  | { kind: 'failure' }
  | { kind: 'incomplete'; reason: string }
> {
  try {
    const fileStat = await stat(path)
    if (fileStat.size > bounds.maxFileBytes) {
      return {
        kind: 'incomplete',
        reason: 'The selected HDL set is too large to scan completely.',
      }
    }
    if (totalBytes + fileStat.size > bounds.maxTotalBytes) {
      return {
        kind: 'incomplete',
        reason: 'The selected HDL set is too large to scan completely.',
      }
    }
    const bytes = await readFile(path)
    const text = decodeHdlBytes(path, bytes)
    if (text === null) return { kind: 'failure' }
    if (Buffer.byteLength(text) > bounds.maxFileBytes) {
      return {
        kind: 'incomplete',
        reason: 'The selected HDL set is too large to scan completely.',
      }
    }
    return { kind: 'ok', text, bytes: Math.max(fileStat.size, Buffer.byteLength(text)) }
  } catch {
    return { kind: 'failure' }
  }
}

function decodeHdlBytes(path: string, bytes: Buffer): string | null {
  try {
    const raw = path.toLowerCase().endsWith('.gz') ? gunzipSync(bytes) : bytes
    return raw.toString('utf8')
  } catch {
    return null
  }
}

function collectDeclaredModules(source: string): {
  names: string[]
  instantiated: Set<string>
} {
  const stripped = stripVerilogComments(source)
  const names: string[] = []
  const bodies = new Map<string, string[]>()
  let match: RegExpExecArray | null
  MODULE_DECLARATION.lastIndex = 0
  while ((match = MODULE_DECLARATION.exec(stripped))) {
    const name = match[1]
    if (!name || !IDENTIFIER.test(name)) continue
    names.push(name)
    const bodyStart = MODULE_DECLARATION.lastIndex
    END_MODULE.lastIndex = bodyStart
    const endMatch = END_MODULE.exec(stripped)
    const bodyEnd = endMatch ? endMatch.index : stripped.length
    const body = stripped.slice(bodyStart, bodyEnd)
    const existing = bodies.get(name)
    if (existing) existing.push(body)
    else bodies.set(name, [body])
    MODULE_DECLARATION.lastIndex = bodyEnd
  }

  const uniqueNames = [...new Set(names)]
  const instantiated = new Set<string>()
  for (const [owner, ownerBodies] of bodies) {
    for (const candidate of uniqueNames) {
      if (candidate === owner || instantiated.has(candidate)) continue
      if (ownerBodies.some((body) => bodyInstantiates(body, candidate))) {
        instantiated.add(candidate)
      }
    }
  }
  return { names, instantiated }
}

function bodyInstantiates(body: string, moduleName: string): boolean {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const direct = new RegExp(String.raw`\b${escaped}\s+[A-Za-z_][A-Za-z0-9_$]*\s*\(`)
  if (direct.test(body)) return true

  const parameterized = new RegExp(String.raw`\b${escaped}\s*#\s*\(`, 'g')
  let match: RegExpExecArray | null
  while ((match = parameterized.exec(body))) {
    const afterParams = skipBalancedParens(body, match.index + match[0].length - 1)
    if (afterParams < 0) continue
    if (/^\s*[A-Za-z_][A-Za-z0-9_$]*\s*\(/.test(body.slice(afterParams))) return true
  }
  return false
}

function skipBalancedParens(source: string, openIndex: number): number {
  if (source[openIndex] !== '(') return -1
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

function rankSuggestedModule(input: {
  candidates: string[]
  designName: string
  manifestTopModule?: string
  sourceTopModule?: string
  instantiated: Set<string>
  fileStems: string[]
}): string {
  const candidates = input.candidates
  if (candidates.length === 0) return ''
  const present = new Set(candidates)
  const ranked = [input.sourceTopModule, input.manifestTopModule, input.designName]
  for (const name of ranked) {
    if (name && present.has(name)) return name
  }

  const uninstantiated = candidates.filter((name) => !input.instantiated.has(name))
  if (uninstantiated.length === 1) return uninstantiated[0]

  const closenessPool = uninstantiated.filter((name) => !TESTBENCH_NAME.test(name))
  const closest = closestIdentifier(
    closenessPool.length > 0 ? closenessPool : uninstantiated,
    input.designName,
    input.fileStems,
  )
  if (closest) return closest
  if (uninstantiated.length > 0) return uninstantiated[0]
  return candidates[0]
}

function closestIdentifier(
  names: string[],
  designName: string,
  fileStems: string[],
): string | undefined {
  if (names.length === 0) return undefined
  let bestName = names[0]
  let bestScore = Number.NEGATIVE_INFINITY
  for (const name of names) {
    const score = identifierCloseness(name, designName, fileStems)
    if (score > bestScore) {
      bestScore = score
      bestName = name
    }
  }
  return bestName
}

function identifierCloseness(
  name: string,
  designName: string,
  fileStems: string[],
): number {
  const lower = name.toLowerCase()
  const design = designName.toLowerCase()
  if (design && lower === design) return 1_000
  if (fileStems.some((stem) => stem.toLowerCase() === lower)) return 900
  if (design && (lower.startsWith(design) || design.startsWith(lower))) {
    return 800 - Math.abs(lower.length - design.length)
  }
  const distances = [
    design ? levenshtein(lower, design) : Number.POSITIVE_INFINITY,
    ...fileStems.map((stem) => levenshtein(lower, stem.toLowerCase())),
  ]
  const distance = Math.min(...distances)
  return Number.isFinite(distance) ? -distance : Number.NEGATIVE_INFINITY
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0
  if (!left) return right.length
  if (!right) return left.length
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    let lastDiagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const nextDiagonal = previous[j]
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, lastDiagonal + cost)
      lastDiagonal = nextDiagonal
    }
  }
  return previous[right.length]
}

function stripVerilogComments(source: string): string {
  let output = ''
  for (let index = 0; index < source.length; ) {
    const current = source[index]
    const next = source[index + 1]
    if (current === '/' && next === '/') {
      index += 2
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (current === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      if (end < 0) break
      output += ' '
      index = end + 2
      continue
    }
    if (current === '"') {
      output += current
      index += 1
      while (index < source.length) {
        output += source[index]
        if (source[index] === '\\' && index + 1 < source.length) {
          output += source[index + 1]
          index += 2
          continue
        }
        if (source[index] === '"') {
          index += 1
          break
        }
        index += 1
      }
      continue
    }
    output += current
    index += 1
  }
  return output
}

function hdlFileStem(path: string): string {
  const base = basename(path)
  const withoutGz = base.toLowerCase().endsWith('.gz') ? base.slice(0, -3) : base
  const extensionStart = withoutGz.lastIndexOf('.')
  return extensionStart > 0 ? withoutGz.slice(0, extensionStart) : withoutGz
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)]
}

function incompleteResult(reason: string): HdlModuleDiscoveryResult {
  return {
    status: 'incomplete',
    candidates: [],
    suggested: '',
    reason,
  }
}
