import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { scanRtlDirectory } from './rtlDirectoryScanner'

describe('scanRtlDirectory', () => {
  let tempRoot = ''

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = ''
    }
  })

  it('recursively collects RTL files and skips ignored directories', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'rtl-scan-'))
    await mkdir(join(tempRoot, 'src', 'core'), { recursive: true })
    await mkdir(join(tempRoot, 'node_modules', 'ignored'), { recursive: true })
    await writeFile(join(tempRoot, 'src', 'top.v'), 'module top(); endmodule\n')
    await writeFile(join(tempRoot, 'src', 'core', 'alu.sv'), 'module alu(); endmodule\n')
    await writeFile(join(tempRoot, 'src', 'readme.txt'), 'ignore me\n')
    await writeFile(join(tempRoot, 'node_modules', 'ignored', 'bad.v'), 'module bad(); endmodule\n')

    const scanned = await scanRtlDirectory(tempRoot)

    expect(scanned.rootPath).toBe(tempRoot)
    expect(scanned.files).toEqual([
      join(tempRoot, 'src', 'core', 'alu.sv'),
      join(tempRoot, 'src', 'top.v'),
    ])
  })
})
