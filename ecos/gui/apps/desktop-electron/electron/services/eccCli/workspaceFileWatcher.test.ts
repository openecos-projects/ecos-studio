import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchWorkspaceOperationFiles } from './workspaceFileWatcher'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

async function writeWorkspace(): Promise<{ projectRoot: string; workspace: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'ecc-cli-watch-project-'))
  roots.push(projectRoot)
  const workspace = join(projectRoot, 'ws_1')
  await mkdir(join(workspace, 'home'), { recursive: true })
  await writeFile(join(projectRoot, 'project.json'), '{"schema_version":1}\n')
  await writeFile(
    join(workspace, 'home', 'flow.json'),
    '{"schema_version":1,"steps":[]}\n',
  )
  return { projectRoot, workspace }
}

/** ECC-style publish: write a same-directory temp file, then atomic rename. */
async function atomicReplace(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, content)
  await rename(temporary, path)
}

describe('watchWorkspaceOperationFiles', () => {
  it('triggers on the atomic replacement of home/flow.json', async () => {
    const { projectRoot, workspace } = await writeWorkspace()
    const onTrigger = vi.fn()
    const watcher = watchWorkspaceOperationFiles({
      projectRoot,
      workspaceDirectory: workspace,
      debounceMs: 20,
      onTrigger,
      onError: () => undefined,
    })
    try {
      await watcher.ready
      await atomicReplace(
        join(workspace, 'home', 'flow.json'),
        '{"schema_version":1,"steps":[{"name":"route","state":"Ongoing"}]}\n',
      )
      await vi.waitFor(() => expect(onTrigger).toHaveBeenCalled(), { timeout: 3000 })
    } finally {
      await watcher.close()
    }
  })

  it('triggers on the atomic replacement of project.json at the project root', async () => {
    const { projectRoot, workspace } = await writeWorkspace()
    const onTrigger = vi.fn()
    const watcher = watchWorkspaceOperationFiles({
      projectRoot,
      workspaceDirectory: workspace,
      debounceMs: 20,
      onTrigger,
      onError: () => undefined,
    })
    try {
      await watcher.ready
      await atomicReplace(
        join(projectRoot, 'project.json'),
        '{"schema_version":1,"runtime_processes":{}}\n',
      )
      await vi.waitFor(() => expect(onTrigger).toHaveBeenCalled(), { timeout: 3000 })
    } finally {
      await watcher.close()
    }
  })

  it('ignores unrelated files in the watched directories', async () => {
    const { projectRoot, workspace } = await writeWorkspace()
    const onTrigger = vi.fn()
    const watcher = watchWorkspaceOperationFiles({
      projectRoot,
      workspaceDirectory: workspace,
      debounceMs: 20,
      onTrigger,
      onError: () => undefined,
    })
    try {
      await watcher.ready
      await atomicReplace(join(workspace, 'home', 'checklist.json'), '{}\n')
      await atomicReplace(join(projectRoot, 'ecc.toml'), '[design]\n')
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(onTrigger).not.toHaveBeenCalled()
    } finally {
      await watcher.close()
    }
  })

  it('stops triggering after close', async () => {
    const { projectRoot, workspace } = await writeWorkspace()
    const onTrigger = vi.fn()
    const watcher = watchWorkspaceOperationFiles({
      projectRoot,
      workspaceDirectory: workspace,
      debounceMs: 20,
      onTrigger,
      onError: () => undefined,
    })
    await watcher.ready
    await watcher.close()
    await atomicReplace(
      join(workspace, 'home', 'flow.json'),
      '{"schema_version":1,"steps":[]}\n',
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(onTrigger).not.toHaveBeenCalled()
  })
})
