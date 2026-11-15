import { randomUUID } from 'node:crypto'
import { readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { parse } from 'smol-toml'

async function inside(root: string, path: string): Promise<string> {
  const resolved = await realpath(path)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Replay path escapes Workspace')
  return resolved
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Replay document')
  return value as Record<string, unknown>
}

async function publish(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(data), { flag: 'wx' })
  await rename(tmp, path)
}

export async function replaySettings(workspace: string): Promise<{ enabled: boolean }> {
  const root = await realpath(workspace)
  const home = await inside(root, join(root, 'home'))
  const path = join(home, 'params.toml')
  try {
    const params = record(parse(await readFile(await inside(root, path), 'utf8'))).params
    const settings = params && record(params).replay
    if (!settings) return { enabled: false }
    const enabled = record(settings).enabled
    if (enabled !== undefined && typeof enabled !== 'boolean')
      throw new Error('Invalid Replay setting')
    return { enabled: enabled === true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { enabled: false }
    throw error
  }
}

export async function buildReplayCatalog(workspace: string): Promise<string> {
  if (!(await replaySettings(workspace)).enabled)
    throw new Error('Replay capture is not enabled for this Workspace')
  const root = await realpath(workspace)
  const home = await inside(root, join(root, 'home'))
  const flow = record(await readJson(await inside(root, join(home, 'flow.json'))))
  if (!Array.isArray(flow.steps) || !flow.steps.length)
    throw new Error('Workspace has no flow steps')
  const steps = []
  for (const raw of flow.steps) {
    const step = record(raw)
    if (typeof step.name !== 'string' || typeof step.tool !== 'string')
      throw new Error('Invalid flow step')
    if (!/^[\w -]+$/.test(step.name) || !/^[\w-]+$/.test(step.tool))
      throw new Error('Invalid flow step identity')
    if (['Ongoing', 'Running'].includes(String(step.state)))
      throw new Error('Replay is available after the flow stops')
    const folder =
      step.name === 'Timing optimization'
        ? 'timing_optimization_sizer'
        : `${step.name}_${step.tool}`
    const base = join(root, folder)
    const runtime =
      typeof step.runtime === 'string' ? step.runtime.split(':').map(Number) : []
    const elapsed = step.resource_observation
      ? record(step.resource_observation).elapsed_seconds
      : undefined
    const seconds =
      typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0
        ? elapsed
        : runtime.length === 3 && runtime.every(Number.isFinite)
          ? runtime[0]! * 3600 + runtime[1]! * 60 + runtime[2]!
          : 0
    const entry: {
      name: string
      seconds: number
      manifest?: string
      reason: string
      metrics: unknown[]
      nodes: { seconds: number; label: string }[]
    } = {
      name: step.name,
      seconds: Math.max(0, seconds),
      reason: 'No Replay capture for this run',
      metrics: [],
      nodes: [],
    }
    if (step.state === 'Success') {
      try {
        const captureRoot = await inside(root, join(base, 'output/geometry/replay'))
        const pointer = record(
          await readJson(await inside(captureRoot, join(captureRoot, 'manifest.json'))),
        )
        if (
          pointer.schema === 'ecos.replay.v1' &&
          pointer.status === 'complete' &&
          typeof pointer.manifest === 'string'
        ) {
          entry.manifest = await inside(captureRoot, join(captureRoot, pointer.manifest))
          const manifest = record(await readJson(entry.manifest))
          if (
            manifest.attempt_id !== pointer.attempt_id ||
            manifest.status !== 'complete' ||
            manifest.schema !== 'ecos.replay.v1'
          )
            throw new Error('Replay attempt mismatch')
          if (
            typeof manifest.duration_ns !== 'number' ||
            !Number.isFinite(manifest.duration_ns) ||
            manifest.duration_ns < 0
          )
            throw new Error('Invalid Replay duration')
          entry.seconds = manifest.duration_ns / 1e9
          if (Array.isArray(manifest.result_metrics))
            entry.metrics = manifest.result_metrics
          if (!Array.isArray(manifest.frames)) throw new Error('Invalid Replay frames')
          let last = ''
          for (const item of manifest.frames) {
            const frame = record(item)
            if (
              typeof frame.subflow !== 'string' ||
              typeof frame.elapsed_ns !== 'number' ||
              !Number.isFinite(frame.elapsed_ns) ||
              frame.elapsed_ns < 0 ||
              frame.elapsed_ns > manifest.duration_ns
            )
              throw new Error('Invalid Replay timeline')
            if (frame.subflow !== last)
              entry.nodes.push({ seconds: frame.elapsed_ns / 1e9, label: frame.subflow })
            last = frame.subflow
          }
          if (Array.isArray(manifest.subflow_timing) && manifest.subflow_timing.length) {
            entry.nodes = manifest.subflow_timing.map((item) => {
              const timing = record(item)
              if (
                typeof timing.name !== 'string' ||
                typeof timing.start_ns !== 'number' ||
                typeof timing.end_ns !== 'number' ||
                !Number.isFinite(timing.end_ns) ||
                !Number.isFinite(timing.start_ns) ||
                timing.start_ns < 0 ||
                timing.end_ns < timing.start_ns ||
                timing.end_ns > Number(manifest.duration_ns)
              )
                throw new Error('Invalid Replay subflow timing')
              const duration = (timing.end_ns - timing.start_ns) / 1e9
              return {
                seconds: timing.end_ns / 1e9,
                label: `${timing.name} · ${duration.toFixed(3)}s`,
              }
            })
          }
          entry.reason = ''
        } else
          entry.reason =
            typeof pointer.reason === 'string'
              ? pointer.reason
              : `Replay ${String(pointer.status)}`
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (!entry.manifest)
        try {
          const metrics = record(
            await readJson(await inside(root, join(base, 'analysis/qor_metrics.json'))),
          )
          if (Array.isArray(metrics.metrics)) entry.metrics = metrics.metrics
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
    }
    steps.push(entry)
  }
  if (!steps.some((step) => step.manifest))
    throw new Error('No Replay data. Enable capture, then rerun the flow.')
  const path = join(home, 'replay-view.json')
  await publish(path, { schema: 'ecos.replay.catalog.v1', workspace: root, steps })
  return path
}
