import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addWorkspaceDesignFiles,
  getWorkspaceFilelistPath,
  listWorkspaceDesignFiles,
  removeWorkspaceDesignFile,
} from './designFileService'

describe('designFileService', () => {
  let tempRoot = ''

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = ''
    }
  })

  it('adds external RTL files to origin/filelist and copies them into origin/', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'design-files-'))
    const workspaceRoot = join(tempRoot, 'workspace')
    const externalDir = join(tempRoot, 'rtl')
    await mkdir(externalDir, { recursive: true })

    const externalFile = join(externalDir, 'top.v')
    await writeFile(externalFile, 'module top(); endmodule\n')

    const result = await addWorkspaceDesignFiles(workspaceRoot, [externalFile])

    expect(result.added).toHaveLength(1)
    expect(result.skipped).toEqual([])
    expect(await readFile(getWorkspaceFilelistPath(workspaceRoot), 'utf8')).toBe('top.v\n')

    const listed = await listWorkspaceDesignFiles(workspaceRoot)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.basename).toBe('top.v')
    expect(listed[0]?.resolvedPath).toBe(join(workspaceRoot, 'origin', 'top.v'))
    expect(listed[0]?.exists).toBe(true)
    expect(listed[0]?.managedInWorkspace).toBe(true)

    const originCopy = join(workspaceRoot, 'origin', 'top.v')
    expect(await readFile(originCopy, 'utf8')).toContain('module top')
  })

  it('skips external files that would overwrite an existing origin file', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'design-files-'))
    const workspaceRoot = join(tempRoot, 'workspace')
    const originDir = join(workspaceRoot, 'origin')
    const externalFile = join(tempRoot, 'top.v')
    await mkdir(originDir, { recursive: true })
    await writeFile(join(originDir, 'top.v'), 'module existing(); endmodule\n')
    await writeFile(externalFile, 'module external(); endmodule\n')

    const result = await addWorkspaceDesignFiles(workspaceRoot, [externalFile])

    expect(result.added).toEqual([])
    expect(result.skipped).toEqual([{
      path: externalFile,
      reason: 'top.v already exists in workspace/origin.',
    }])
    expect(await readFile(join(originDir, 'top.v'), 'utf8')).toContain('module existing')
    await expect(access(getWorkspaceFilelistPath(workspaceRoot))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('removes a file from filelist and deletes the managed origin copy', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'design-files-'))
    const workspaceRoot = join(tempRoot, 'workspace')
    const externalFile = join(tempRoot, 'alu.sv')
    await writeFile(externalFile, 'module alu(); endmodule\n')

    const added = await addWorkspaceDesignFiles(workspaceRoot, [externalFile])
    const filelistEntry = added.added[0]?.filelistEntry
    expect(filelistEntry).toBeTruthy()

    const removed = await removeWorkspaceDesignFile(workspaceRoot, filelistEntry!)
    expect(removed?.basename).toBe('alu.sv')
    expect(await listWorkspaceDesignFiles(workspaceRoot)).toEqual([])
  })
})
