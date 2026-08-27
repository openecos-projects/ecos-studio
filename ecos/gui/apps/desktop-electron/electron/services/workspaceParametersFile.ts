import { open, realpath, rename, rm, stat, writeFile, chmod } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomInt } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { parse, stringify } from 'smol-toml'
import { normalizeParameterKey, normalizeParameterKeys } from '@ecos-studio/shared'

export const WORKSPACE_CONFIG_BASENAME = 'ecc.toml'
export const LEGACY_PARAMETERS_BASENAME = 'parameters.json'

export type WorkspaceParametersFormat = 'toml' | 'json'

export interface WorkspaceParametersFileLocation {
  format: WorkspaceParametersFormat
  path: string
  /**
   * The path as spelled before canonicalization (authorizedLocation only):
   * reads and writes address the spelled leaf with no-follow semantics, so
   * an alias swapped in after authorization fails instead of redirecting
   * the operation to the alias target.
   */
  spelledPath?: string
}

// Mirrors of the section mapping in ecc chipcompiler/data/workspace_config.py
// (_DESIGN_SECTION_KEYS / _PDK_SECTION_KEYS). Keep aligned with ecc.
const DESIGN_SECTION_KEYS: Readonly<Record<string, string>> = {
  design: 'name',
  top_module: 'top',
  clock: 'clock_port',
  frequency_max: 'frequency_mhz',
}

const PDK_SECTION_KEYS: Readonly<Record<string, string>> = {
  pdk: 'name',
  pdk_root: 'root',
  pdk_config: 'config',
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Merge an overlay into a base document leaf-wise: plain records merge
 * recursively (unknown nested keys survive a save the GUI did not touch),
 * while arrays, scalars, and class instances (e.g. TOML dates) replace.
 */
function mergeRecordsPreservingUnknown(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key]
    merged[key] =
      isPlainRecord(existing) && isPlainRecord(value)
        ? mergeRecordsPreservingUnknown(existing, value)
        : value
  }
  return merged
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

/**
 * Locate the workspace's persisted parameters: `home/ecc.toml` (canonical)
 * first, legacy `home/parameters.json` (older backend workspaces and all
 * frontend ecc-fe workspaces) as fallback.
 */
export async function locateWorkspaceParametersFile(
  root: string,
): Promise<WorkspaceParametersFileLocation | null> {
  const tomlPath = join(root, 'home', WORKSPACE_CONFIG_BASENAME)
  if (await isFile(tomlPath)) {
    return { format: 'toml', path: tomlPath }
  }
  const jsonPath = join(root, 'home', LEGACY_PARAMETERS_BASENAME)
  if (await isFile(jsonPath)) {
    return { format: 'json', path: jsonPath }
  }
  return null
}

/**
 * The writable sections must be plain tables: a scalar/array section (or a
 * scalar-like object such as a TOML date) is a configuration error, never a
 * silently-empty section to overwrite. Shared by the read flatten and every
 * write merge.
 */
function assertTomlSectionShapes(document: Record<string, unknown>): void {
  for (const section of ['params', 'design', 'pdk'] as const) {
    if (section in document && !isPlainRecord(document[section])) {
      throw new Error(
        `Invalid workspace configuration: [${section}] must be a table, got ${
          Array.isArray(document[section]) ? 'array' : typeof document[section]
        }`,
      )
    }
  }
}

/**
 * Flatten an ecc.toml document into the canonical flat parameter payload.
 * Mirrors ecc's `_merge_payload`: `[params]` is the base, then non-empty
 * `[design]`/`[pdk]` mirror values override their mapped parameter keys.
 * A workspace-relative `pdk_config` resolves against the workspace root.
 * Keys are canonicalized on the way out so a hand-authored display key
 * (e.g. `Target density`) cannot shadow the same parameter elsewhere.
 * A section that exists but is not a table is a configuration error,
 * never a silently-empty section.
 */
export function mergeTomlSections(
  document: Record<string, unknown>,
  workspaceRoot: string,
): Record<string, unknown> {
  assertTomlSectionShapes(document)
  const params: Record<string, unknown> = {
    ...(normalizeParameterKeys(
      isRecord(document.params) ? document.params : {},
    ) as Record<string, unknown>),
  }
  const design = isRecord(document.design) ? document.design : {}
  const pdk = isRecord(document.pdk) ? document.pdk : {}

  for (const [paramKey, sectionKey] of Object.entries(DESIGN_SECTION_KEYS)) {
    const value = design[sectionKey]
    if (hasValue(value)) params[paramKey] = value
  }
  for (const [paramKey, sectionKey] of Object.entries(PDK_SECTION_KEYS)) {
    const value = pdk[sectionKey]
    if (hasValue(value)) params[paramKey] = value
  }

  const pdkConfig = params.pdk_config
  if (typeof pdkConfig === 'string' && pdkConfig && !isAbsolute(pdkConfig)) {
    params.pdk_config = join(workspaceRoot, pdkConfig)
  }
  return params
}

/**
 * smol-toml parses datetimes at millisecond resolution, so a date scalar
 * with finer precision (e.g. 07:32:00.999999) silently truncates on every
 * save — including untouched values in [flow] and unknown sections. Refuse
 * the write instead of corrupting the document. Strings and comments are
 * skipped; a time-looking token inside a multiline string may fail closed,
 * which is still safer than a silent truncation.
 */
function assertNoSubMillisecondDatetimes(text: string, label: string): void {
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '#') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '"' || char === "'") {
      const quote = char
      index += 1
      while (index < text.length && text[index] !== quote) {
        index += quote === '"' && text[index] === '\\' ? 2 : 1
      }
      index += 1
      continue
    }
    const timeMatch = /^\d{2}:\d{2}:\d{2}\.(\d+)/.exec(text.slice(index))
    if (timeMatch && timeMatch[1].length > 3) {
      throw new Error(
        `Refusing to rewrite ${label}: datetime ${timeMatch[0]} exceeds ` +
          'millisecond precision and would be truncated',
      )
    }
    index += 1
  }
}

/**
 * Parse a TOML document that must hold a plain table at its root: a scalar
 * document (e.g. a bare TOML date) is a configuration error, not an empty
 * parameter set to overwrite on the next save.
 */
function parseTomlDocument(text: string, label: string): Record<string, unknown> {
  const document: unknown = parse(text, { integersAsBigInt: 'asNeeded' })
  if (!isPlainRecord(document)) {
    throw new Error(
      `Invalid workspace configuration: ${label} must contain a TOML table at the root`,
    )
  }
  return document
}

/**
 * Parse workspace parameters from file content of the given format. Pure:
 * no filesystem access, so callers can run it behind their own path-scope
 * authorization. Parse failures throw.
 */
export function parseWorkspaceParametersText(
  text: string,
  format: WorkspaceParametersFormat,
  workspaceRoot: string,
): Record<string, unknown> {
  if (format === 'json') {
    const parsed: unknown = parseJsonPreservingIntegers(
      text,
      join(workspaceRoot, 'home', LEGACY_PARAMETERS_BASENAME),
    )
    if (!isRecord(parsed)) {
      throw new Error(
        'Invalid workspace configuration: parameters JSON must contain a JSON object',
      )
    }
    return parsed
  }
  const document = parseTomlDocument(
    text,
    join(workspaceRoot, 'home', WORKSPACE_CONFIG_BASENAME),
  )
  return mergeTomlSections(document, workspaceRoot)
}

/**
 * Read the workspace parameters regardless of on-disk format. Returns null
 * when neither file exists; parse failures propagate (never silently fall
 * back to defaults).
 */
export async function readWorkspaceParameters(
  root: string,
): Promise<Record<string, unknown> | null> {
  const location = await locateWorkspaceParametersFile(root)
  if (!location) return null
  const text = await readFileNoFollow(location.path)
  return parseWorkspaceParametersText(text, location.format, root)
}

/**
 * Read a config file through its spelled path: the spelled parent must
 * resolve to the authorized (canonical) directory, and the leaf is opened
 * no-follow. An alias swapped in after authorization therefore fails the
 * open (ELOOP) instead of silently reading the alias target, and a parent
 * directory swapped for a symlink fails the containment check — verified
 * before AND after the read, so a mid-read swap discards the data instead
 * of returning it.
 */
export async function readWorkspaceConfigContained(
  spelledPath: string,
  canonicalPath: string,
): Promise<string> {
  const authorizedParent = dirname(canonicalPath)
  if ((await realpath(dirname(spelledPath))) !== authorizedParent) {
    throw new Error(
      `Refusing to read ${spelledPath}: it no longer resolves to the authorized config`,
    )
  }
  const text = await readFileNoFollow(spelledPath)
  if ((await realpath(dirname(spelledPath))) !== authorizedParent) {
    throw new Error(
      `Refusing to read ${spelledPath}: parent directory changed during the read`,
    )
  }
  return text
}

/**
 * Read a config file without following a symlinked final component: when
 * the file is swapped to a symlink after authorization, the open fails with
 * ELOOP instead of leaking the link target into a merged document.
 */
export async function readFileNoFollow(path: string): Promise<string> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      return await handle.readFile('utf8')
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (isErrno(error, 'ELOOP')) {
      throw new Error(`Refusing to read through a symlink: ${path}`)
    }
    throw error
  }
}

export async function writeTextAtomically(
  path: string,
  content: string,
  options?: { authorizedParent?: string },
): Promise<void> {
  // Random suffix + exclusive create: a predictable name could be reused by a
  // concurrent writer, and a pre-planted symlink could redirect the write.
  const parent = dirname(path)
  // The anchor is the parent the caller AUTHORIZED, never a freshly derived
  // one: deriving it here could adopt a directory swapped in after
  // authorization as the accepted target.
  const canonicalParent = options?.authorizedParent ?? (await realpath(parent))
  // The replacement keeps the existing file's mode: a 0600 config must not
  // become 0644 (umask default) after a save.
  let mode: number | undefined
  try {
    mode = (await stat(path)).mode & 0o777
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error
  }
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${randomInt(0, 1_000_000)}.tmp`
  try {
    if ((await realpath(parent)) !== canonicalParent) {
      throw new Error(
        `Refusing to write ${path}: parent directory changed before the write`,
      )
    }
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    if (mode !== undefined) {
      await chmod(temporaryPath, mode)
    }
    // Write and rename both address the parent by pathname: revalidate that
    // it still resolves to the authorized directory, so a symlink swapped in
    // after authorization cannot redirect the rename outside the workspace.
    // Node has no dirfd-relative rename, so the rename itself is followed by
    // a final verification that fails loud (a misplaced file is reported,
    // never silently removed — another swap could make the cleanup delete
    // an unrelated file).
    if ((await realpath(parent)) !== canonicalParent) {
      throw new Error(
        `Refusing to write ${path}: parent directory changed during the write`,
      )
    }
    await rename(temporaryPath, path)
    if ((await realpath(parent)) !== canonicalParent) {
      throw new Error(
        `Refusing to write ${path}: parent directory changed during the rename; ` +
          'the new content may have landed outside the workspace — inspect the directory',
      )
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Per-path serialization for read-modify-write operations. The GUI save and
 * the agent/rerun edit paths both read the current configuration, merge in
 * memory, then atomically replace the file; without a shared lock, two
 * overlapping operations can read the same revision and the later rename
 * silently discards the earlier operation's unrelated changes.
 */
const parameterWriteQueues = new Map<string, Promise<unknown>>()

async function enqueueParameterWrite<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = parameterWriteQueues.get(path) ?? Promise.resolve()
  const next = previous.then(operation, operation)
  const settled = next.catch(() => undefined)
  parameterWriteQueues.set(path, settled)
  try {
    return await next
  } finally {
    if (parameterWriteQueues.get(path) === settled) {
      parameterWriteQueues.delete(path)
    }
  }
}

/**
 * Incoming payload/edit values face the same rules as the document on disk:
 * a non-finite number would serialize as null (JSON) or inf/nan (TOML)
 * instead of failing. Checked recursively before any merge.
 */
function assertFiniteNumbers(value: unknown, label: string): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`Refusing to write ${label}: non-finite number in parameters payload`)
  }
  if (Array.isArray(value)) {
    for (const item of value) assertFiniteNumbers(item, label)
    return
  }
  if (isPlainRecord(value)) {
    for (const item of Object.values(value)) assertFiniteNumbers(item, label)
  }
}

/**
 * Merge a parameter payload into the existing TOML document. `[params]` is
 * updated wholesale per top-level key (display keys are normalized first,
 * mirroring ecc's `normalize_parameter_dict`), the `[design]`/`[pdk]`
 * mirrors are re-synced from the merged params (mirroring ecc's
 * `_split_payload`), `pdk_config` absolutes inside the workspace are stored
 * relative (mirroring `render_workspace_config`), and every other section
 * (`[flow]`, unknown sections) is preserved untouched.
 *
 * Existing `[params]` keys are canonicalized before merging: a hand-authored
 * display key (e.g. `Target density`) would otherwise shadow the edit,
 * because ecc gives the long key precedence on collisions. Mirrors of an
 * emptied parameter are deleted so a stale non-empty section value cannot
 * resurrect it on the next load.
 */
export function mergePayloadIntoTomlDocument(
  document: Record<string, unknown>,
  payload: Record<string, unknown>,
  workspaceRoot: string,
): Record<string, unknown> & {
  design: Record<string, unknown>
  pdk: Record<string, unknown>
  params: Record<string, unknown>
} {
  assertTomlSectionShapes(document)
  const flatPayload = normalizeParameterKeys(payload) as Record<string, unknown>
  // Seed from the FLATTENED document (ecc's _merge_payload semantics:
  // non-empty section mirrors override [params]), not from [params] alone —
  // a section-only value like [pdk] config is a live parameter that must
  // survive the mirror re-sync instead of being deleted as a stale mirror.
  const existingParams = mergeTomlSections(document, workspaceRoot)
  // Leaf-wise merge: unknown nested members (e.g. a future ecc knob under
  // [params.core]) survive a save that only rewrites known fields; arrays,
  // scalars, and date values replace wholesale.
  const params = mergeRecordsPreservingUnknown(existingParams, flatPayload)

  const pdkConfig = params.pdk_config
  if (typeof pdkConfig === 'string' && pdkConfig && isAbsolute(pdkConfig)) {
    const resolvedConfig = resolve(pdkConfig)
    const workspaceResolved = resolve(workspaceRoot)
    const relativeConfig = relative(workspaceResolved, resolvedConfig)
    if (relativeConfig && !relativeConfig.startsWith('..') && relativeConfig !== '') {
      params.pdk_config = relativeConfig
    }
  }

  const design: Record<string, unknown> = {
    ...(isRecord(document.design) ? document.design : {}),
  }
  for (const [paramKey, sectionKey] of Object.entries(DESIGN_SECTION_KEYS)) {
    const value = params[paramKey]
    if (hasValue(value)) {
      design[sectionKey] = value
    } else {
      delete design[sectionKey]
    }
  }

  const pdk: Record<string, unknown> = { ...(isRecord(document.pdk) ? document.pdk : {}) }
  for (const [paramKey, sectionKey] of Object.entries(PDK_SECTION_KEYS)) {
    const value = params[paramKey]
    if (hasValue(value)) {
      pdk[sectionKey] = value
    } else {
      delete pdk[sectionKey]
    }
  }

  return { ...document, design, pdk, params }
}

/**
 * Persist workspace parameters. On a TOML workspace the payload is merged
 * into `home/ecc.toml`; on a legacy/frontend (parameters.json) workspace
 * the JSON file is rewritten as-is. Throws when neither file exists.
 *
 * When `authorizedLocation` is provided (a path already authorized and
 * canonicalized by the caller's path scope), the write uses exactly that
 * file instead of re-locating it, closing the locate→authorize→write
 * symlink swap window.
 */
export async function writeWorkspaceParameters(
  root: string,
  payload: Record<string, unknown>,
  authorizedLocation?: WorkspaceParametersFileLocation,
  assertWritable?: () => Promise<void>,
): Promise<WorkspaceParametersFileLocation> {
  const location = authorizedLocation ?? (await locateWorkspaceParametersFile(root))
  if (!location) {
    throw new Error(
      `Workspace parameters file not found: ${join(root, 'home', WORKSPACE_CONFIG_BASENAME)} or ${join(root, 'home', LEGACY_PARAMETERS_BASENAME)}`,
    )
  }
  // Serialize per workspace config slot, not per file: the on-disk format
  // can change (a legacy JSON migrates to TOML) while an operation queues,
  // and two operations must never interleave across the two files.
  return await enqueueParameterWrite(`${root}/home:parameters`, async () => {
    // Runtime-activity guards re-run INSIDE the queue: a flow starting while
    // this operation waited behind another writer must still block it.
    await assertWritable?.()
    assertFiniteNumbers(payload, location.path)
    // Re-locate at the head of the queue: when the preferred config changed
    // while this operation waited (parameters.json -> ecc.toml migration),
    // the write must land where subsequent reads will look.
    const onDisk = await locateWorkspaceParametersFile(root)
    if (!onDisk) {
      throw new Error(
        `Workspace parameters file not found: ${join(root, 'home', WORKSPACE_CONFIG_BASENAME)} or ${join(root, 'home', LEGACY_PARAMETERS_BASENAME)}`,
      )
    }
    const spelledPath = onDisk.path
    const canonicalPath = authorizedLocation
      ? authorizedLocation.path
      : await realpath(onDisk.path)
    if (onDisk.format === 'json') {
      // Merge into the existing document: the payload is the GUI's known
      // parameter set, not the whole file — keys the GUI does not display
      // (frontend extras, unrelated agent edits) must survive a save.
      const raw = await readWorkspaceConfigContained(spelledPath, canonicalPath)
      const existing = parseJsonPreservingIntegers(raw, onDisk.path)
      if (!isRecord(existing)) {
        throw new Error(
          `Invalid workspace configuration: ${onDisk.path} must contain a JSON object`,
        )
      }
      const merged = mergeRecordsPreservingUnknown(existing, payload)
      // One more guard pass between the merge and the rename: a flow that
      // started while this operation read and merged must still block the
      // commit (the remaining window is the rename itself; closing it needs
      // the runtime's own cross-process lock).
      await assertWritable?.()
      await writeTextAtomically(spelledPath, `${JSON.stringify(merged, null, 4)}\n`, {
        authorizedParent: dirname(canonicalPath),
      })
      return onDisk
    }
    const raw = await readWorkspaceConfigContained(spelledPath, canonicalPath)
    assertNoSubMillisecondDatetimes(raw, onDisk.path)
    const document = parseTomlDocument(raw, onDisk.path)
    const merged = mergePayloadIntoTomlDocument(document, payload, root)
    await assertWritable?.()
    await writeTextAtomically(spelledPath, stringify(merged), {
      authorizedParent: dirname(canonicalPath),
    })
    return onDisk
  })
}

export interface WorkspaceParameterEdit {
  json_path: readonly (string | number)[]
  value: unknown
}

function detectJsonIndent(raw: string): number {
  return /^\s*[[{]\s*\n(\s+)\S/.exec(raw)?.[1]?.length ?? 4
}

/**
 * JSON.parse silently rounds numbers beyond Number.MAX_SAFE_INTEGER, so
 * reading or rewriting a config would corrupt values the operation never
 * touched. Scan number literals outside strings — every form (integer,
 * decimal, exponent) — and refuse when the parsed value is an integer past
 * the safe range, i.e. the literal cannot round-trip exactly.
 */
function assertJsonIntegersSafe(text: string, label: string): void {
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      index += 1
      while (index < text.length && text[index] !== '"') {
        index += text[index] === '\\' ? 2 : 1
      }
      index += 1
      continue
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      const token = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index))?.[0]
      if (token) {
        const parsed = Number(token)
        if (!Number.isFinite(parsed)) {
          // 1e400 overflows to Infinity and would be rewritten as null.
          throw new Error(
            `Unsafe number ${token} in ${label}: not representable as a finite number`,
          )
        }
        if (Number.isInteger(parsed) && Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
          throw new Error(
            `Unsafe number ${token} in ${label}: exceeds ` +
              'Number.MAX_SAFE_INTEGER and would lose precision',
          )
        }
        index += token.length
        continue
      }
    }
    index += 1
  }
}

function parseJsonPreservingIntegers(text: string, label: string): unknown {
  assertJsonIntegersSafe(text, label)
  return JSON.parse(text)
}

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function readJsonPathSegment(node: unknown, key: string | number): unknown {
  if (typeof key === 'number') {
    return Array.isArray(node) && key < node.length ? node[key] : undefined
  }
  return isRecord(node) && Object.hasOwn(node, key) ? node[key] : undefined
}

/**
 * Existing-path-only set: every segment of the path must already exist,
 * mirroring the agent write contract (no invented keys). String segments
 * must be own properties — an inherited lookup (`__proto__`, `constructor`)
 * would otherwise pass the existence check and let an assignment mutate
 * `Object.prototype` inside the Electron main process.
 */
function setJsonPathValue(
  document: Record<string, unknown>,
  jsonPath: readonly (string | number)[],
  value: unknown,
  label: string,
): void {
  const missing = (): never => {
    throw new Error(
      `Parameter path ${JSON.stringify(jsonPath)} does not exist in ${label}.`,
    )
  }
  for (const segment of jsonPath) {
    if (typeof segment === 'string' && FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      throw new Error(
        `Parameter path ${JSON.stringify(jsonPath)} is not allowed in ${label}.`,
      )
    }
  }
  let node: unknown = document
  for (const key of jsonPath.slice(0, -1)) {
    node = readJsonPathSegment(node, key) ?? missing()
  }
  const last = jsonPath[jsonPath.length - 1]
  if (last === undefined || readJsonPathSegment(node, last) === undefined) missing()
  if (typeof last === 'number') (node as unknown[])[last] = value
  else (node as Record<string, unknown>)[last] = value
}

/**
 * Apply existing-path-only edits to the workspace configuration that
 * actually exists on disk (`home/ecc.toml` preferred, legacy
 * `home/parameters.json` fallback). Edit paths are interpreted in the
 * on-disk file's vocabulary: display keys for JSON, and for TOML every
 * string segment is canonicalized through the ecc mechanical rule, so an
 * agent emitting display-key paths keeps working after the migration.
 *
 * When `authorizedLocation` is provided (a path already authorized and
 * canonicalized by the caller's path scope), the operation uses exactly
 * that file instead of re-locating it, closing the locate→authorize→read
 * symlink swap window.
 */
export async function editWorkspaceParameters(
  root: string,
  edits: readonly WorkspaceParameterEdit[],
  authorizedLocation?: WorkspaceParametersFileLocation,
  assertWritable?: () => Promise<void>,
): Promise<WorkspaceParametersFileLocation> {
  const location = authorizedLocation ?? (await locateWorkspaceParametersFile(root))
  if (!location) {
    throw new Error(
      `Workspace parameters file not found: ${join(root, 'home', WORKSPACE_CONFIG_BASENAME)} or ${join(root, 'home', LEGACY_PARAMETERS_BASENAME)}`,
    )
  }
  return await enqueueParameterWrite(`${root}/home:parameters`, async () => {
    // Runtime-activity guards re-run INSIDE the queue: a flow starting while
    // this operation waited behind another writer must still block it.
    await assertWritable?.()
    for (const edit of edits) {
      assertFiniteNumbers(edit.value, location.path)
    }
    // Re-locate at the head of the queue: when the preferred config changed
    // while this operation waited (parameters.json -> ecc.toml migration),
    // the edit must land where subsequent reads will look.
    const onDisk = await locateWorkspaceParametersFile(root)
    if (!onDisk) {
      throw new Error(
        `Workspace parameters file not found: ${join(root, 'home', WORKSPACE_CONFIG_BASENAME)} or ${join(root, 'home', LEGACY_PARAMETERS_BASENAME)}`,
      )
    }
    const spelledPath = onDisk.path
    const canonicalPath = authorizedLocation
      ? authorizedLocation.path
      : await realpath(onDisk.path)
    const raw = await readWorkspaceConfigContained(spelledPath, canonicalPath)
    if (onDisk.format === 'json') {
      const parsed: unknown = parseJsonPreservingIntegers(raw, onDisk.path)
      if (!isRecord(parsed)) {
        throw new Error(
          `Invalid workspace configuration: ${onDisk.path} must contain a JSON object`,
        )
      }
      const document = parsed
      for (const edit of edits) {
        setJsonPathValue(document, edit.json_path, edit.value, onDisk.path)
      }
      const serialized = JSON.stringify(document, null, detectJsonIndent(raw))
      // One more guard pass between the edits and the rename: a flow that
      // started while this operation read and merged must still block the
      // commit (the remaining window is the rename itself; closing it needs
      // the runtime's own cross-process lock).
      await assertWritable?.()
      await writeTextAtomically(
        spelledPath,
        raw.endsWith('\n') ? `${serialized}\n` : serialized,
        { authorizedParent: dirname(canonicalPath) },
      )
      return onDisk
    }
    assertNoSubMillisecondDatetimes(raw, onDisk.path)
    const document = parseTomlDocument(raw, onDisk.path)
    const parameters = mergeTomlSections(document, root)
    for (const edit of edits) {
      const normalizedPath = edit.json_path.map((segment) =>
        typeof segment === 'string' ? normalizeParameterKey(segment) : segment,
      )
      setJsonPathValue(parameters, normalizedPath, edit.value, onDisk.path)
    }
    const merged = mergePayloadIntoTomlDocument(document, parameters, root)
    await assertWritable?.()
    await writeTextAtomically(spelledPath, stringify(merged), {
      authorizedParent: dirname(canonicalPath),
    })
    return onDisk
  })
}
