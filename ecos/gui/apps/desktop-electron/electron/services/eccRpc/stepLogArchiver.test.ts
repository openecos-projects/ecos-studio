import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  StepLogArchiver,
  parseStepMarker,
  readFlowJsonStepAllowlist,
  stepLogKey,
  type StepLogSegment,
  type StepLogStepRef,
} from './stepLogArchiver'

function markerLine(payload: string): Buffer {
  return Buffer.from(`\x1eECC-STEP ${payload}\n`, 'utf8')
}

function v1Marker(event: string, step: string, tool: string): Buffer {
  return markerLine(`{"v":1,"event":"${event}","step":"${step}","tool":"${tool}"}`)
}

interface Harness {
  archiver: StepLogArchiver
  workspace: string
  segments: StepLogSegment[]
  ended: StepLogStepRef[]
  unscoped: string[]
  violations: string[]
  archivePath: (step: string, tool: string) => string
  readArchive: (step: string, tool: string) => Buffer
}

function makeHarness(
  options: {
    allowlist?: StepLogStepRef[]
    batchBytes?: number
    batchWindowMs?: number
    tailBytes?: number
  } = {},
): Harness {
  const workspace = mkdtempSync(join(tmpdir(), 'step-log-archiver-'))
  const segments: StepLogSegment[] = []
  const ended: StepLogStepRef[] = []
  const unscoped: string[] = []
  const violations: string[] = []
  const archiver = new StepLogArchiver({
    workspaceDirectory: workspace,
    onSegment: (segment) => segments.push(segment),
    onStepEnded: (step) => ended.push(step),
    onUnscoped: (text) => unscoped.push(text),
    onProtocolViolation: (reason) => violations.push(reason),
    ...(options.batchBytes !== undefined ? { batchBytes: options.batchBytes } : {}),
    ...(options.batchWindowMs !== undefined
      ? { batchWindowMs: options.batchWindowMs }
      : {}),
    ...(options.tailBytes !== undefined ? { tailBytes: options.tailBytes } : {}),
  })
  if (options.allowlist) {
    archiver.refreshAllowlist(
      options.allowlist.map((ref) => stepLogKey(ref.step, ref.tool)),
    )
  }
  return {
    archiver,
    workspace,
    segments,
    ended,
    unscoped,
    violations,
    archivePath: (step, tool) => join(workspace, `${step}_${tool}`, 'log', `${step}.log`),
    readArchive: (step, tool) =>
      readFileSync(join(workspace, `${step}_${tool}`, 'log', `${step}.log`)),
  }
}

describe('parseStepMarker', () => {
  it('round-trips begin and end frames', () => {
    expect(parseStepMarker(v1Marker('begin', 'Synthesis', 'yosys'))).toEqual({
      event: 'begin',
      step: 'Synthesis',
      tool: 'yosys',
    })
    expect(parseStepMarker(v1Marker('end', 'Placement', 'ecc'))).toEqual({
      event: 'end',
      step: 'Placement',
      tool: 'ecc',
    })
  })

  it('accepts a frame without a trailing newline', () => {
    const line = Buffer.from('\x1eECC-STEP {"v":1,"event":"begin","step":"S","tool":"T"}')
    expect(parseStepMarker(line)?.event).toBe('begin')
  })

  it('rejects lines without the prefix', () => {
    expect(parseStepMarker(Buffer.from('normal log line\n'))).toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseStepMarker(markerLine('{bad json}'))).toBeNull()
  })

  it('rejects non-object payloads', () => {
    expect(parseStepMarker(markerLine('[]'))).toBeNull()
    expect(parseStepMarker(markerLine('42'))).toBeNull()
    expect(parseStepMarker(markerLine('"hello"'))).toBeNull()
    expect(parseStepMarker(markerLine('true'))).toBeNull()
    expect(parseStepMarker(markerLine('null'))).toBeNull()
  })

  it('rejects missing fields', () => {
    expect(parseStepMarker(markerLine('{"v":1,"event":"begin"}'))).toBeNull()
  })

  it('rejects wrong field types', () => {
    expect(
      parseStepMarker(markerLine('{"v":1,"event":1,"step":"A","tool":"B"}')),
    ).toBeNull()
  })

  it('rejects a missing version', () => {
    expect(
      parseStepMarker(markerLine('{"event":"begin","step":"S","tool":"T"}')),
    ).toBeNull()
  })

  it('rejects an unsupported version', () => {
    expect(
      parseStepMarker(markerLine('{"v":2,"event":"begin","step":"S","tool":"T"}')),
    ).toBeNull()
  })

  it('rejects a string version', () => {
    expect(
      parseStepMarker(markerLine('{"v":"1","event":"begin","step":"S","tool":"T"}')),
    ).toBeNull()
  })

  it('rejects a boolean version', () => {
    expect(
      parseStepMarker(markerLine('{"v":true,"event":"begin","step":"S","tool":"T"}')),
    ).toBeNull()
  })

  it('rejects a non-UTF-8 payload (normative parity with the Python reader)', () => {
    const line = Buffer.concat([
      Buffer.from('\x1eECC-STEP {"v":1,"event":"begin","step":"S', 'utf8'),
      Buffer.from([0xff]),
      Buffer.from('","tool":"T"}\n', 'utf8'),
    ])
    expect(parseStepMarker(line)).toBeNull()
  })
})

describe('StepLogArchiver marker state machine', () => {
  let workspaceDirs: string[] = []

  function harness(options: Parameters<typeof makeHarness>[0] = {}): Harness {
    const h = makeHarness(options)
    workspaceDirs.push(h.workspace)
    return h
  }

  beforeEach(() => {
    workspaceDirs = []
  })

  afterEach(() => {
    for (const dir of workspaceDirs) {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('archives bytes between matched markers and consumes the markers', () => {
    const h = harness({ allowlist: [{ step: 'Synthesis', tool: 'yosys' }] })
    h.archiver.feed(v1Marker('begin', 'Synthesis', 'yosys'))
    h.archiver.feed(Buffer.from('yosys output line 1\n'))
    h.archiver.feed(Buffer.from('yosys output line 2\n'))
    h.archiver.feed(v1Marker('end', 'Synthesis', 'yosys'))

    const content = h.readArchive('Synthesis', 'yosys')
    expect(content.toString()).toContain('yosys output line 1\n')
    expect(content.toString()).toContain('yosys output line 2\n')
    expect(content.toString()).not.toContain('ECC-STEP')
    expect(h.ended).toEqual([{ step: 'Synthesis', tool: 'yosys' }])
    expect(h.unscoped).toEqual([])
  })

  it('switches archives across multiple steps', () => {
    const h = harness({
      allowlist: [
        { step: 'A', tool: 't' },
        { step: 'B', tool: 't' },
      ],
    })
    h.archiver.feed(v1Marker('begin', 'A', 't'))
    h.archiver.feed(Buffer.from('output A\n'))
    h.archiver.feed(v1Marker('end', 'A', 't'))
    h.archiver.feed(v1Marker('begin', 'B', 't'))
    h.archiver.feed(Buffer.from('output B\n'))
    h.archiver.feed(v1Marker('end', 'B', 't'))

    expect(h.readArchive('A', 't').toString()).toBe('output A\n')
    expect(h.readArchive('B', 't').toString()).toBe('output B\n')
    expect(h.ended).toEqual([
      { step: 'A', tool: 't' },
      { step: 'B', tool: 't' },
    ])
  })

  it('preserves non-UTF-8 bytes exactly in the archive', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    const raw = Buffer.from([0x80, 0x81, 0xff, 0xfe, 0x20, 0x62, 0x0a])
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(raw)
    h.archiver.feed(v1Marker('end', 'S', 'T'))
    expect(h.readArchive('S', 'T')).toEqual(raw)
  })

  it('treats a malformed marker line as data', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(markerLine('{bad json}'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))
    expect(h.readArchive('S', 'T').toString()).toContain('{bad json}')
  })

  it('treats an unknown event as data', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    const unknown = v1Marker('pause', 'S', 'T')
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(unknown)
    h.archiver.feed(v1Marker('end', 'S', 'T'))
    expect(h.readArchive('S', 'T')).toEqual(unknown)
  })

  it('treats an unversioned marker as data', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    const unversioned = markerLine('{"event":"begin","step":"S","tool":"T"}')
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(unversioned)
    h.archiver.feed(v1Marker('end', 'S', 'T'))
    expect(h.readArchive('S', 'T')).toEqual(unversioned)
  })

  it('assembles a marker split across chunks', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    const begin = v1Marker('begin', 'S', 'T')
    h.archiver.feed(begin.subarray(0, 10))
    h.archiver.feed(begin.subarray(10))
    h.archiver.feed(Buffer.from('body\n'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))
    expect(h.readArchive('S', 'T').toString()).toBe('body\n')
    expect(h.unscoped).toEqual([])
  })

  it('holds a candidate at exactly 512 bytes, then consumes the frame', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    const prefix = Buffer.from('\x1eECC-STEP ', 'utf8')
    // Pad via an extra JSON field (protocol-legal) so the step name stays
    // short enough for the filesystem.
    const wrapper = '{"v":1,"event":"begin","step":"S","tool":"T","pad":""}'
    const pad = 512 - prefix.length - wrapper.length
    const frameHead = Buffer.concat([
      prefix,
      Buffer.from(
        `{"v":1,"event":"begin","step":"S","tool":"T","pad":"${'a'.repeat(pad)}"}`,
        'utf8',
      ),
    ])
    expect(frameHead.length).toBe(512)
    h.archiver.feed(frameHead)
    expect(h.unscoped).toEqual([])
    h.archiver.feed(Buffer.from('\nbody\n'))
    h.archiver.feed(
      Buffer.from('\x1eECC-STEP {"v":1,"event":"end","step":"S","tool":"T"}\n', 'utf8'),
    )
    expect(h.ended).toEqual([{ step: 'S', tool: 'T' }])
    expect(h.unscoped.join('')).toBe('')
    expect(h.readArchive('S', 'T').toString()).toBe('body\n')
  })

  it('degrades a candidate longer than 512 bytes without a newline', () => {
    const h = harness({ allowlist: [] })
    const overlong = Buffer.concat([
      Buffer.from('\x1eECC-STEP ', 'utf8'),
      Buffer.alloc(503, 0x61),
    ])
    h.archiver.feed(overlong)
    expect(h.unscoped.join('')).toBe(overlong.toString('utf8'))
  })

  it('emits an overlong marker-less prefix fragment as data', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    const fragment = Buffer.concat([
      Buffer.from('\x1eECC-STEP '),
      Buffer.alloc(600, 0x61),
    ])
    h.archiver.feed(fragment)
    expect(h.unscoped.join('')).toContain('ECC-STEP')
    expect(h.unscoped.join('').length).toBeGreaterThan(600)
  })

  it('does not close the archive on a mismatched end marker', () => {
    const h = harness({ allowlist: [{ step: 'A', tool: 'T' }] })
    const mismatched = v1Marker('end', 'B', 'T')
    h.archiver.feed(v1Marker('begin', 'A', 'T'))
    h.archiver.feed(Buffer.from('before\n'))
    h.archiver.feed(mismatched)
    h.archiver.feed(Buffer.from('after\n'))
    h.archiver.feed(v1Marker('end', 'A', 'T'))
    const content = h.readArchive('A', 'T')
    expect(content.toString()).toContain('before\n')
    expect(content.toString()).toContain(mismatched.toString())
    expect(content.toString()).toContain('after\n')
  })

  it('does not switch archives on a nested begin marker', () => {
    const h = harness({
      allowlist: [
        { step: 'A', tool: 'T' },
        { step: 'B', tool: 'T' },
      ],
    })
    const nested = v1Marker('begin', 'B', 'T')
    h.archiver.feed(v1Marker('begin', 'A', 'T'))
    h.archiver.feed(Buffer.from('before\n'))
    h.archiver.feed(nested)
    h.archiver.feed(Buffer.from('after\n'))
    h.archiver.feed(v1Marker('end', 'A', 'T'))
    const content = h.readArchive('A', 'T')
    expect(content.toString()).toContain('before\n')
    expect(content.toString()).toContain(nested.toString())
    expect(content.toString()).toContain('after\n')
    expect(existsSync(h.archivePath('B', 'T'))).toBe(false)
  })

  it('treats a non-allowlisted marker as ordinary bytes', () => {
    const h = harness({ allowlist: [{ step: 'Synthesis', tool: 'yosys' }] })
    const unknown = v1Marker('begin', 'Bogus', 'fake')
    h.archiver.feed(unknown)
    h.archiver.feed(Buffer.from('trailing\n'))
    expect(h.unscoped.join('')).toContain('Bogus')
    expect(h.unscoped.join('')).toContain('trailing\n')
    expect(existsSync(h.archivePath('Bogus', 'fake'))).toBe(false)
  })

  it('rejects separator names and archives nothing for them', () => {
    const h = harness({ allowlist: [{ step: 'foo/bar', tool: 'ecc' }] })
    const unsafe = v1Marker('begin', 'foo/bar', 'ecc')
    h.archiver.feed(unsafe)
    h.archiver.feed(Buffer.from('body bytes\n'))
    expect(h.violations.some((reason) => reason.includes('unsafe'))).toBe(true)
    expect(h.unscoped.join('')).toContain(unsafe.toString())
    expect(h.unscoped.join('')).toContain('body bytes\n')
    expect(existsSync(join(h.workspace, 'foo'))).toBe(false)
  })

  it('rejects dot-segment names', () => {
    const h = harness({ allowlist: [{ step: '..', tool: '..' }] })
    const unsafe = v1Marker('begin', '..', '..')
    h.archiver.feed(unsafe)
    expect(h.violations.some((reason) => reason.includes('unsafe'))).toBe(true)
    expect(h.unscoped.join('')).toBe(unsafe.toString())
  })

  it('never writes a resolved path escaping the workspace', () => {
    const h = harness({ allowlist: [{ step: 'Escape', tool: 'evil' }] })
    // A symlinked step directory inside the workspace points outside it.
    const outside = mkdtempSync(join(tmpdir(), 'step-log-outside-'))
    workspaceDirs.push(outside)
    symlinkSync(outside, join(h.workspace, 'Escape_evil'), 'dir')

    h.archiver.feed(v1Marker('begin', 'Escape', 'evil'))
    h.archiver.feed(Buffer.from('should not be written\n'))

    expect(existsSync(join(outside, 'log', 'Escape.log'))).toBe(false)
    expect(h.violations.length).toBeGreaterThan(0)
  })

  it('routes unscoped bytes to onUnscoped only', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    h.archiver.feed(Buffer.from('free bytes\n'))
    expect(h.unscoped).toEqual(['free bytes\n'])
    expect(existsSync(h.archivePath('S', 'T'))).toBe(false)
  })

  it('routes bytes after an end marker to unscoped', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('scoped\n'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))
    h.archiver.feed(Buffer.from('unscoped\n'))
    expect(h.readArchive('S', 'T').toString()).toBe('scoped\n')
    expect(h.unscoped).toEqual(['unscoped\n'])
  })

  it('truncates the archive on rerun and restarts the cursor', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('first attempt output\n'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('second\n'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))

    expect(h.readArchive('S', 'T').toString()).toBe('second\n')
    const cursors = h.segments.map((segment) => segment.cursor)
    expect(cursors[0]).toBe('first attempt output\n'.length)
    expect(cursors[1]).toBe('second\n'.length)
  })

  it('refreshes the allowlist between runs', () => {
    const h = harness({ allowlist: [{ step: 'A', tool: 't' }] })
    h.archiver.feed(v1Marker('begin', 'B', 't'))
    expect(h.unscoped.join('')).toContain('B')
    h.archiver.refreshAllowlist([stepLogKey('B', 't')])
    h.unscoped.length = 0
    h.archiver.feed(v1Marker('begin', 'B', 't'))
    h.archiver.feed(Buffer.from('now archived\n'))
    h.archiver.feed(v1Marker('end', 'B', 't'))
    expect(h.readArchive('B', 't').toString()).toBe('now archived\n')
    expect(h.unscoped).toEqual([])
  })

  it('consumes an end marker glued to output without a trailing newline', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('last line without newline'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))

    expect(h.readArchive('S', 'T').toString()).toBe('last line without newline')
    expect(h.ended).toEqual([{ step: 'S', tool: 'T' }])
    expect(h.unscoped).toEqual([])
  })

  it('consumes an end marker split across chunks after unterminated output', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('unterminated'))
    const end = v1Marker('end', 'S', 'T')
    for (let offset = 0; offset < end.length; offset += 7) {
      h.archiver.feed(end.subarray(offset, offset + 7))
    }

    expect(h.readArchive('S', 'T').toString()).toBe('unterminated')
    expect(h.ended).toEqual([{ step: 'S', tool: 'T' }])
  })

  it('archives an invalid marker mid-line as data', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('glued text \x1eECC-STEP {bad json}\n'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))

    const content = h.readArchive('S', 'T').toString()
    expect(content).toContain('glued text ')
    expect(content).toContain('{bad json}')
    expect(h.ended).toEqual([{ step: 'S', tool: 'T' }])
  })

  it('recovers a valid marker following an overlong candidate', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    const overlong = Buffer.concat([
      Buffer.from('\x1eECC-STEP '),
      Buffer.alloc(600, 0x61),
    ])
    const end = v1Marker('end', 'S', 'T')
    const combined = Buffer.concat([overlong, end])
    for (let offset = 0; offset < combined.length; offset += 100) {
      h.archiver.feed(combined.subarray(offset, offset + 100))
    }

    const content = h.readArchive('S', 'T')
    expect(content.toString()).toContain('a'.repeat(600))
    expect(content.toString()).not.toContain('"event":"end"')
    expect(h.ended).toEqual([{ step: 'S', tool: 'T' }])
  })
})

describe('StepLogArchiver batching and tail', () => {
  let workspaceDirs: string[] = []

  function harness(options: Parameters<typeof makeHarness>[0] = {}): Harness {
    const h = makeHarness(options)
    workspaceDirs.push(h.workspace)
    return h
  }

  beforeEach(() => {
    workspaceDirs = []
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const dir of workspaceDirs) {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('batches segments below the byte threshold until the window fires', () => {
    vi.useFakeTimers()
    const h = harness({
      allowlist: [{ step: 'S', tool: 'T' }],
      batchBytes: 1024,
      batchWindowMs: 100,
    })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('small chunk\n'))
    expect(h.segments).toEqual([])

    vi.advanceTimersByTime(100)
    expect(h.segments).toHaveLength(1)
    expect(h.segments[0]).toMatchObject({
      chunk: 'small chunk\n',
      cursor: 'small chunk\n'.length,
      step: 'S',
      tool: 'T',
    })
    expect(h.readArchive('S', 'T').toString()).toBe('small chunk\n')
  })

  it('flushes immediately once the batch byte threshold is reached', () => {
    vi.useFakeTimers()
    const h = harness({
      allowlist: [{ step: 'S', tool: 'T' }],
      batchBytes: 16,
      batchWindowMs: 10_000,
    })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('0123456789abcdef\n'))
    expect(h.segments).toHaveLength(1)
    expect(h.segments[0]!.cursor).toBe(17)
    vi.advanceTimersByTime(20_000)
    expect(h.segments).toHaveLength(1)
  })

  it('flushes pending bytes before reporting the step end', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'step-log-order-'))
    workspaceDirs.push(workspace)
    const order: string[] = []
    const archiver = new StepLogArchiver({
      workspaceDirectory: workspace,
      onSegment: () => order.push('segment'),
      onStepEnded: () => order.push('ended'),
      onUnscoped: () => undefined,
      batchBytes: 64 * 1024,
    })
    archiver.refreshAllowlist([stepLogKey('S', 'T')])

    archiver.feed(v1Marker('begin', 'S', 'T'))
    archiver.feed(Buffer.from('pending bytes\n'))
    archiver.feed(v1Marker('end', 'S', 'T'))

    expect(order).toEqual(['segment', 'ended'])
    expect(readFileSync(join(workspace, 'S_T', 'log', 'S.log')).toString()).toBe(
      'pending bytes\n',
    )
  })

  it('maintains a bounded per-step tail for finalLog', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }], tailBytes: 8 })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('0123456789\n'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))
    expect(h.archiver.tail('S', 'T')).toBe('3456789\n')
  })

  it('degrades to unscoped when the archive cannot be opened', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    // A regular file where the step directory belongs makes mkdir fail.
    writeFileSync(join(h.workspace, 'S_T'), 'not a directory')
    const begin = v1Marker('begin', 'S', 'T')
    h.archiver.feed(begin)
    h.archiver.feed(Buffer.from('step body\n'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))

    const unscoped = h.unscoped.join('')
    expect(unscoped).toContain(begin.toString())
    expect(unscoped).toContain('step body\n')
    expect(h.violations.some((reason) => reason.includes('archive open failed'))).toBe(
      true,
    )
    expect(h.ended).toEqual([])
    expect(h.segments).toEqual([])
  })

  it('bounds the tail even for a single oversized chunk', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }], tailBytes: 8 })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('0123456789ABCDEF\n'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))
    expect(h.archiver.tail('S', 'T')).toBe('9ABCDEF\n')
  })

  it('abandons the archive on write error but keeps the tail', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }], batchBytes: 4 })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('good\n'))
    expect(h.segments).toHaveLength(1)

    // Force the next write to fail: replace the archive file with a directory.
    rmSync(h.archivePath('S', 'T'))
    mkdirSync(h.archivePath('S', 'T'))

    h.archiver.feed(Buffer.from('lost\n'))
    h.archiver.feed(Buffer.from('tail only\n'))
    h.archiver.feed(v1Marker('end', 'S', 'T'))

    expect(h.violations.some((reason) => reason.includes('archive write failed'))).toBe(
      true,
    )
    expect(h.ended).toEqual([{ step: 'S', tool: 'T' }])
    expect(h.archiver.tail('S', 'T')).toContain('tail only\n')
  })

  it('close flushes pending bytes to the archive without emitting events', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }], batchBytes: 64 * 1024 })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('pending at close\n'))
    h.archiver.close()

    expect(h.readArchive('S', 'T').toString()).toBe('pending at close\n')
    expect(h.segments).toEqual([])
    expect(h.ended).toEqual([])
  })

  it('close routes a truncated trailing marker candidate to unscoped', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    h.archiver.feed(Buffer.from('\x1eECC-STEP {bad'))
    h.archiver.close()
    expect(h.unscoped.join('')).toBe('\x1eECC-STEP {bad')
  })

  it('close archives a trailing partial line of the active step', () => {
    const h = harness({ allowlist: [{ step: 'S', tool: 'T' }] })
    h.archiver.feed(v1Marker('begin', 'S', 'T'))
    h.archiver.feed(Buffer.from('complete line\n'))
    h.archiver.feed(Buffer.from('partial without newline'))
    h.archiver.close()
    expect(h.readArchive('S', 'T').toString()).toBe(
      'complete line\npartial without newline',
    )
  })
})

describe('readFlowJsonStepAllowlist', () => {
  it('reads (name, tool) pairs from flow.json', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'flow-json-allowlist-'))
    mkdirSync(join(workspace, 'home'), { recursive: true })
    writeFileSync(
      join(workspace, 'home', 'flow.json'),
      JSON.stringify({
        steps: [
          { name: 'Synthesis', tool: 'yosys', state: 'Success' },
          { name: 'Floorplan', tool: 'ecc', state: 'Unstart' },
        ],
      }),
    )
    const keys = readFlowJsonStepAllowlist(workspace)
    expect(keys).toEqual(
      new Set([stepLogKey('Synthesis', 'yosys'), stepLogKey('Floorplan', 'ecc')]),
    )
    rmSync(workspace, { force: true, recursive: true })
  })

  it('returns an empty set for a missing flow.json', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'flow-json-missing-'))
    expect(readFlowJsonStepAllowlist(workspace).size).toBe(0)
    rmSync(workspace, { force: true, recursive: true })
  })

  it('returns an empty set for malformed flow.json', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'flow-json-bad-'))
    mkdirSync(join(workspace, 'home'), { recursive: true })
    writeFileSync(join(workspace, 'home', 'flow.json'), '{not json')
    expect(readFlowJsonStepAllowlist(workspace).size).toBe(0)
    rmSync(workspace, { force: true, recursive: true })
  })
})
