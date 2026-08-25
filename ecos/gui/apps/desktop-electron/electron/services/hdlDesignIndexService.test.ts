import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HdlDesignIndexService } from './hdlDesignIndexService'

const temporaryDirectories: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ecos-hdl-index-'))
  temporaryDirectories.push(root)
  const home = join(root, 'home')
  const source = join(home, 'chips', 'gcd')
  await mkdir(source, { recursive: true })
  const rtl = join(source, 'gcd.v')
  const sdc = join(source, 'constraints.sdc')
  await writeFile(rtl, 'module gcd(input clk); endmodule\n')
  await writeFile(sdc, 'create_clock -period 10 [get_ports clk]\n')
  return { home, root, rtl, sdc }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  )
})

describe('HdlDesignIndexService', () => {
  it('builds a private Home index and returns a clustered RTL/SDC design', async () => {
    const { home, root, rtl, sdc } = await fixture()
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'updatedb') {
        const output = args[args.indexOf('-o') + 1]
        await writeFile(output!, 'index')
        return ''
      }
      if (args.at(-1) === '*gcd*.v') return `${rtl}\0`
      if (args.at(-1) === '*.sdc') return `${sdc}\0`
      if (args.at(-1) === '*.f') {
        throw Object.assign(new Error('no matches'), { code: 1 })
      }
      return ''
    })
    const service = new HdlDesignIndexService({
      binaryPaths: { plocate: 'plocate', updatedb: 'updatedb' },
      homePath: home,
      indexDirectory: join(root, 'index'),
      run,
    })

    await service.refresh(true)
    const candidates = await service.query({ designName: 'gcd', limit: 3 })

    expect(service.getStatus()).toMatchObject({ state: 'ready', rootCount: 1 })
    expect(candidates).toEqual([
      expect.objectContaining({
        clock: 'clk',
        designName: 'gcd',
        rtlPath: rtl,
        sdcPath: sdc,
        topModule: 'gcd',
      }),
    ])
    expect(run).toHaveBeenCalledWith(
      'updatedb',
      expect.arrayContaining(['-l', '0', '-U', home]),
      expect.anything(),
    )
    expect(run).toHaveBeenCalledWith(
      'plocate',
      expect.arrayContaining(['*gcd*.v']),
      expect.anything(),
    )
    const designQuery = run.mock.calls.find(([, args]) => args.at(-1) === '*gcd*.v')
    expect(designQuery?.[1]).not.toContain('-b')
  })

  it('refreshes automatically when a Project outside Home is added', async () => {
    const { home, root } = await fixture()
    const project = join(root, 'external-project')
    await mkdir(project)
    const indexedRoots: string[] = []
    let currentTime = new Date('2026-01-01T00:00:00Z')
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'updatedb') {
        indexedRoots.push(args[args.indexOf('-U') + 1]!)
        await writeFile(args[args.indexOf('-o') + 1]!, 'index')
      }
      return ''
    })
    const service = new HdlDesignIndexService({
      binaryPaths: { plocate: 'plocate', updatedb: 'updatedb' },
      homePath: home,
      indexDirectory: join(root, 'index'),
      now: () => currentTime,
      run,
    })
    await service.refresh(true)
    currentTime = new Date('2026-01-01T12:00:00Z')
    indexedRoots.splice(0)
    const refreshed = new Promise<void>((resolve) => {
      service.onStatus((status) => {
        if (status.state === 'ready' && status.rootCount === 2) resolve()
      })
    })

    service.updateRoots([project])
    await refreshed

    expect(indexedRoots).toEqual([project])

    indexedRoots.splice(0)
    currentTime = new Date('2026-01-02T01:00:00Z')
    await service.refresh(false)
    expect(indexedRoots).toEqual([home])
  })

  it('infers the unique top module and clock from clustered design files', async () => {
    const { home, root } = await fixture()
    const source = join(home, 'soc')
    await mkdir(source)
    const rtl = join(source, 'chip.v')
    const unrelatedRtl = join(source, 'peripheral.sv')
    const otherProject = join(home, 'other-project', 'rtl')
    await mkdir(otherProject, { recursive: true })
    const otherProjectRtl = join(otherProject, 'other.sv')
    const sdc = join(source, 'constraints.sdc')
    const filelist = join(source, 'sources.f')
    const unrelatedFilelist = join(source, 'aaa.f')
    await writeFile(
      rtl,
      'module leaf(); endmodule\nmodule chip_top(input sys_clk, input reset); leaf u_leaf(); endmodule\n',
    )
    await writeFile(unrelatedRtl, 'module peripheral(input reset); endmodule\n')
    await writeFile(otherProjectRtl, 'module other(input sys_clk); endmodule\n')
    await writeFile(
      sdc,
      'set_input_delay 1 [get_ports reset]\ncreate_clock -period 10 [get_ports sys_clk]\n',
    )
    await writeFile(filelist, 'chip.v\n')
    await writeFile(unrelatedFilelist, 'other.v\n')
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'updatedb') {
        await writeFile(args[args.indexOf('-o') + 1]!, 'index')
        return ''
      }
      if (args.at(-1) === '*.v') return `${rtl}\0`
      if (args.at(-1) === '*.sv') return `${unrelatedRtl}\0${otherProjectRtl}\0`
      if (args.at(-1) === '*.sdc') return `${sdc}\0`
      if (args.at(-1) === '*.f') return `${unrelatedFilelist}\0${filelist}\0`
      return ''
    })
    const service = new HdlDesignIndexService({
      binaryPaths: { plocate: 'plocate', updatedb: 'updatedb' },
      homePath: home,
      indexDirectory: join(root, 'index'),
      run,
    })
    service.updateRoots([join(home, 'other-project')], join(home, 'other-project'))
    await service.refresh(true)

    const candidates = await service.query({ limit: 3 })
    expect(candidates[0]?.rtlPath).toBe(otherProjectRtl)
    expect(candidates).toContainEqual(
      expect.objectContaining({
        clock: 'sys_clk',
        filelistPath: filelist,
        topModule: 'chip_top',
      }),
    )
    expect(candidates.find((candidate) => candidate.rtlPath === unrelatedRtl)).toEqual(
      expect.not.objectContaining({
        filelistPath: expect.anything(),
        sdcPath: expect.anything(),
      }),
    )
    expect(
      candidates.find((candidate) => candidate.rtlPath === otherProjectRtl),
    ).not.toHaveProperty('sdcPath')
  })

  it('queues a Project added while the Home index is still building', async () => {
    const { home, root } = await fixture()
    const project = join(root, 'external-project')
    await mkdir(project)
    let releaseHome!: () => void
    const homeBlocked = new Promise<void>((resolve) => {
      releaseHome = resolve
    })
    let homeStarted!: () => void
    const started = new Promise<void>((resolve) => {
      homeStarted = resolve
    })
    const indexedRoots: string[] = []
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command !== 'updatedb') return ''
      const indexedRoot = args[args.indexOf('-U') + 1]!
      if (indexedRoot === home) {
        homeStarted()
        await homeBlocked
      }
      indexedRoots.push(indexedRoot)
      await writeFile(args[args.indexOf('-o') + 1]!, 'index')
      return ''
    })
    const service = new HdlDesignIndexService({
      binaryPaths: { plocate: 'plocate', updatedb: 'updatedb' },
      homePath: home,
      indexDirectory: join(root, 'index'),
      run,
    })
    const initialRefresh = service.refresh(true)
    await started
    const projectReady = new Promise<void>((resolve) => {
      service.onStatus((status) => {
        if (status.state === 'ready' && indexedRoots.includes(project)) resolve()
      })
    })
    service.updateRoots([project])
    releaseHome()

    await initialRefresh
    await projectReady
    expect(indexedRoots).toEqual([home, project])
  })
})
