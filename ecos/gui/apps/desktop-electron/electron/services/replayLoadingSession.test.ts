import { access, writeFile } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { ReplayLoadingSession } from './replayLoadingSession'

const sessions: ReplayLoadingSession[] = []
async function session() {
  const value = await ReplayLoadingSession.create()
  sessions.push(value)
  return value
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((value) => value.dispose()))
})
const progress = {
  state: 'loading',
  phase: 'Finding layout changes',
  name: 'route',
  step: 12,
  steps: 22,
  frame: 18,
  frames: 69,
}

it('isolates startup reports and removes them on exit', async () => {
  const a = await session()
  const b = await session()
  expect(a.path).not.toBe(b.path)
  await writeFile(a.path, JSON.stringify(progress))
  expect(await a.read()).toEqual(progress)
  expect((await b.read()).phase).toBe('Starting Chip Viewer')
  await writeFile(a.path, JSON.stringify({ ...progress, state: 'ready' }))
  expect((await a.read()).state).toBe('ready')
  await a.dispose()
  await expect(access(a.path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each([
  '{',
  JSON.stringify({ ...progress, step: 100 }),
  JSON.stringify({ ...progress, frame: -1 }),
  JSON.stringify({ ...progress, frame: 0.5 }),
  JSON.stringify({ ...progress, frames: '69' }),
  JSON.stringify({ ...progress, phase: 'x'.repeat(9000) }),
  JSON.stringify({ ...progress, state: 'unknown' }),
])('keeps the last valid snapshot on malformed or oversized output (%#)', async (bad) => {
  const value = await session()
  await writeFile(value.path, JSON.stringify(progress))
  expect(await value.read()).toEqual(progress)
  await writeFile(value.path, bad)
  expect(await value.read()).toEqual(progress)
})
