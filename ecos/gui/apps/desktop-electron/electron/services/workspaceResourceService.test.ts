import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceResourceService } from './workspaceResourceService'

const tempDirectories: string[] = []
type ProjectScopeProviderDouble = ConstructorParameters<typeof WorkspaceResourceService>[0]['projectScopeProvider']

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ecos-resource-resolver-'))
  tempDirectories.push(directory)
  return directory
}

function provider(root: string): ProjectScopeProviderDouble {
  return {
    getProjectRoot: vi.fn().mockResolvedValue(root),
    requestProjectPathAccess: vi.fn(async (path: string) => path),
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8')
}

async function writeWorkspace(
  root: string,
  steps: Array<{ name: string, tool: string, state?: string, runtime?: string, info?: Record<string, unknown> }>,
): Promise<void> {
  await mkdir(join(root, 'home'), { recursive: true })
  await writeJson(join(root, 'home', 'parameters.json'), {
    Design: 'gcd',
    'Top module': 'gcd',
    PDK: 'ics55',
  })
  await writeJson(join(root, 'home', 'flow.json'), {
    steps: steps.map((step) => ({
      name: step.name,
      tool: step.tool,
      state: step.state ?? 'Success',
      runtime: step.runtime ?? '',
      info: step.info ?? {},
    })),
  })
  await writeJson(join(root, 'home', 'home.json'), {})
}

describe('WorkspaceResourceService', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    )
  })

  it('builds an ECC step resource index from parameters and flow files', async () => {
    const root = await tempWorkspace()
    await mkdir(join(root, 'home'), { recursive: true })
    await mkdir(join(root, 'place_ecc', 'output'), { recursive: true })
    await mkdir(join(root, 'place_ecc', 'analysis'), { recursive: true })
    await writeJson(join(root, 'home', 'parameters.json'), {
      Design: 'gcd',
      'Top module': 'gcd',
      PDK: 'ics55',
    })
    await writeJson(join(root, 'home', 'flow.json'), {
      steps: [{ name: 'place', tool: 'ecc', state: 'Success', runtime: '00:00:01', info: {} }],
    })
    await writeJson(join(root, 'home', 'home.json'), { flow: join(root, 'home', 'flow.json') })
    await writeFile(join(root, 'place_ecc', 'output', 'gcd_place.json'), '{}', 'utf8')
    await writeFile(join(root, 'place_ecc', 'output', 'gcd_place.png'), 'png', 'utf8')
    await writeFile(join(root, 'place_ecc', 'analysis', 'place_metrics.json'), '{}', 'utf8')

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const index = await service.getIndex()

    expect(index.status).toBe('available')
    expect(index.design).toBe('gcd')
    expect(index.topModule).toBe('gcd')
    expect(index.pdk).toBe('ics55')
    expect(index.flow.steps).toHaveLength(1)
    expect(index.flow.steps[0].directory).toBe(join(root, 'place_ecc'))
    expect(index.flow.steps[0].resources.output.json).toMatchObject({
      path: join(root, 'place_ecc', 'output', 'gcd_place.json'),
      exists: true,
      kind: 'layout-json',
    })
    expect(index.flow.steps[0].resources.output.image).toMatchObject({
      path: join(root, 'place_ecc', 'output', 'gcd_place.png'),
      exists: true,
      kind: 'layout-image',
    })
  })

  it('exposes workspace-level view package tech resources from the design view directory', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'place', tool: 'ecc' }])
    await mkdir(join(root, 'gcd_view', 'tech'), { recursive: true })
    await writeJson(join(root, 'gcd_view', 'manifest.json'), {
      schema: 'ieda.view.v1',
      format: 'layout_view_package',
      files: {
        meta: 'meta.json',
        layers: 'tech/layers.json',
        sites: 'tech/sites.json',
        vias: 'tech/vias.json',
        cell_masters: 'tech/cell_masters.json',
      },
    })
    await writeJson(join(root, 'gcd_view', 'meta.json'), {})
    await writeJson(join(root, 'gcd_view', 'tech', 'layers.json'), {})
    await writeJson(join(root, 'gcd_view', 'tech', 'sites.json'), {})
    await writeJson(join(root, 'gcd_view', 'tech', 'vias.json'), {})
    await writeJson(join(root, 'gcd_view', 'tech', 'cell_masters.json'), {})

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const index = await service.getIndex()

    expect(index.tech).toMatchObject({
      packageRoot: join(root, 'gcd_view'),
      source: 'view-package',
      manifest: {
        path: join(root, 'gcd_view', 'manifest.json'),
        exists: true,
        kind: 'tech-json',
      },
      layers: {
        path: join(root, 'gcd_view', 'tech', 'layers.json'),
        exists: true,
        kind: 'tech-json',
      },
      sites: {
        path: join(root, 'gcd_view', 'tech', 'sites.json'),
        exists: true,
        kind: 'tech-json',
      },
      vias: {
        path: join(root, 'gcd_view', 'tech', 'vias.json'),
        exists: true,
        kind: 'tech-json',
      },
      cellMasters: {
        path: join(root, 'gcd_view', 'tech', 'cell_masters.json'),
        exists: true,
        kind: 'tech-json',
      },
    })
  })

  it('discovers tech resources from a step output view package', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'place', tool: 'dreamplace' }])
    const packageRoot = join(root, 'place_dreamplace', 'output', 'gcd_place_view')
    await mkdir(join(packageRoot, 'tech'), { recursive: true })
    await writeJson(join(packageRoot, 'manifest.json'), {
      schema: 'ieda.view.v1',
      format: 'layout_view_package',
      files: {
        meta: 'meta.json',
        layers: 'tech/layers.json',
        sites: 'tech/sites.json',
        vias: 'tech/vias.json',
        cell_masters: 'tech/cell_masters.json',
      },
    })
    await writeJson(join(packageRoot, 'meta.json'), {})
    await writeJson(join(packageRoot, 'tech', 'layers.json'), {})
    await writeJson(join(packageRoot, 'tech', 'sites.json'), {})
    await writeJson(join(packageRoot, 'tech', 'vias.json'), {})
    await writeJson(join(packageRoot, 'tech', 'cell_masters.json'), {})

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const index = await service.getIndex()

    expect(index.tech).toMatchObject({
      packageRoot,
      source: 'view-package',
      manifest: {
        path: join(packageRoot, 'manifest.json'),
        exists: true,
        kind: 'tech-json',
      },
      layers: {
        path: join(packageRoot, 'tech', 'layers.json'),
        exists: true,
        kind: 'tech-json',
      },
      sites: {
        path: join(packageRoot, 'tech', 'sites.json'),
        exists: true,
        kind: 'tech-json',
      },
      vias: {
        path: join(packageRoot, 'tech', 'vias.json'),
        exists: true,
        kind: 'tech-json',
      },
      cellMasters: {
        path: join(packageRoot, 'tech', 'cell_masters.json'),
        exists: true,
        kind: 'tech-json',
      },
    })
  })

  it('keeps the resource index available when a discovered tech package has missing tech files', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'place', tool: 'ecc' }])
    await mkdir(join(root, 'gcd_view', 'tech'), { recursive: true })
    await writeJson(join(root, 'gcd_view', 'manifest.json'), {
      schema: 'ieda.view.v1',
      format: 'layout_view_package',
      files: {
        layers: 'tech/layers.json',
        sites: 'tech/sites.json',
        vias: 'tech/vias.json',
        cell_masters: 'tech/cell_masters.json',
      },
    })
    await writeJson(join(root, 'gcd_view', 'tech', 'layers.json'), {})

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const index = await service.getIndex()

    expect(index.status).toBe('available')
    expect(index.tech?.layers.exists).toBe(true)
    expect(index.tech?.sites).toMatchObject({
      path: join(root, 'gcd_view', 'tech', 'sites.json'),
      exists: false,
      kind: 'tech-json',
    })
    expect(index.tech?.vias.exists).toBe(false)
    expect(index.tech?.cellMasters.exists).toBe(false)
  })

  it('returns resolveStepInfo(layout) with missing files instead of throwing', async () => {
    const root = await tempWorkspace()
    await mkdir(join(root, 'home'), { recursive: true })
    await writeJson(join(root, 'home', 'parameters.json'), {
      Design: 'gcd',
      'Top module': 'gcd',
      PDK: 'ics55',
    })
    await writeJson(join(root, 'home', 'flow.json'), {
      steps: [{ name: 'route', tool: 'ecc', state: 'Unstart', runtime: '', info: {} }],
    })
    await writeJson(join(root, 'home', 'home.json'), {})

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: 'ROUTE', id: 'layout' })

    expect(result).toMatchObject({
      step: 'route',
      id: 'layout',
      response: 'missing',
      info: {
        image: join(root, 'route_ecc', 'output', 'gcd_route.png'),
        json: join(root, 'route_ecc', 'output', 'gcd_route.json'),
      },
    })
    expect(result.missing).toEqual(expect.arrayContaining([
      join(root, 'route_ecc', 'output', 'gcd_route.png'),
      join(root, 'route_ecc', 'output', 'gcd_route.json'),
    ]))
  })

  it('returns the step view JSON package from resolveStepInfo(layout)', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'place', tool: 'dreamplace' }])
    await mkdir(join(root, 'place_dreamplace', 'output', 'gcd_place_view'), { recursive: true })
    await writeFile(
      join(root, 'place_dreamplace', 'output', 'gcd_place_view', 'manifest.json'),
      '{}',
      'utf8',
    )

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: 'place', id: 'layout' })

    expect(result).toMatchObject({
      step: 'place',
      id: 'layout',
      response: 'missing',
      info: {
        viewJson: join(root, 'place_dreamplace', 'output', 'gcd_place_view'),
      },
    })
    expect(result.missing).toContain(join(root, 'place_dreamplace', 'output', 'gcd_place.json'))
    expect(result.missing).not.toContain(join(root, 'place_dreamplace', 'output', 'gcd_place_view'))
  })

  it('maps yosys config to flow_config.json', async () => {
    const root = await tempWorkspace()
    await mkdir(join(root, 'home'), { recursive: true })
    await writeJson(join(root, 'home', 'parameters.json'), {
      Design: 'gcd',
      'Top module': 'gcd',
      PDK: 'ics55',
    })
    await writeJson(join(root, 'home', 'flow.json'), {
      steps: [{ name: 'Synthesis', tool: 'yosys', state: 'Success', runtime: '', info: {} }],
    })
    await writeJson(join(root, 'home', 'home.json'), {})

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: 'synthesis', id: 'config' })

    expect(result).toMatchObject({
      step: 'Synthesis',
      response: 'missing',
      info: { path: join(root, 'config', 'flow_config.json') },
      missing: [join(root, 'config', 'flow_config.json')],
    })
  })

  it.each([
    ['place', 'pl_default_config.json'],
    ['Floorplan', 'fp_default_config.json'],
    ['optDrv', 'to_default_config_drv.json'],
    ['CTS', 'cts_default_config.json'],
  ])('maps ECC %s config to the workspace config directory', async (stepName, configFile) => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: stepName, tool: 'ecc' }])
    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(join(root, 'config', configFile), '{}', 'utf8')

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: stepName.toLowerCase(), id: 'config' })

    expect(result).toMatchObject({
      step: stepName,
      response: 'available',
      info: { config: join(root, 'config', configFile) },
      missing: [],
    })
  })

  it('returns available empty maps info when the density map directory does not exist', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'place', tool: 'ecc' }])

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: 'place', id: 'maps' })

    expect(result).toMatchObject({
      step: 'place',
      id: 'maps',
      response: 'available',
      info: {},
      missing: [],
    })
  })

  it('returns density map PNGs in the renderer map gallery shape', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'place', tool: 'ecc' }])
    await mkdir(join(root, 'place_ecc', 'feature', 'density_map'), { recursive: true })
    await writeFile(join(root, 'place_ecc', 'feature', 'density_map', 'cell_density.png'), 'png', 'utf8')
    await writeFile(join(root, 'place_ecc', 'feature', 'density_map', 'rudy-horizontal.png'), 'png', 'utf8')
    await writeFile(join(root, 'place_ecc', 'feature', 'density_map', 'notes.txt'), 'ignore', 'utf8')

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: 'place', id: 'maps' })

    expect(result).toMatchObject({
      step: 'place',
      id: 'maps',
      response: 'available',
      info: {
        cell_density: {
          path: join(root, 'place_ecc', 'feature', 'density_map', 'cell_density.png'),
          info: [],
        },
        'rudy-horizontal': {
          path: join(root, 'place_ecc', 'feature', 'density_map', 'rudy-horizontal.png'),
          info: [],
        },
      },
      missing: [],
    })
    expect(result.info).not.toHaveProperty('notes')
    expect(result.info).not.toHaveProperty('map')
  })

  it('includes index messages when a step is not found because flow and parameters are missing', async () => {
    const root = await tempWorkspace()
    await mkdir(join(root, 'home'), { recursive: true })

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: 'place', id: 'config' })

    expect(result).toMatchObject({
      response: 'missing',
      info: {},
      missing: [],
    })
    expect(result.message).toEqual(expect.arrayContaining([
      `Workspace step not found: place`,
      `Missing workspace parameters: ${join(root, 'home', 'parameters.json')}`,
      `Missing workspace flow: ${join(root, 'home', 'flow.json')}`,
    ]))
  })

  it('exposes planned yosys resource keys in the index', async () => {
    const root = await tempWorkspace()
    await mkdir(join(root, 'home'), { recursive: true })
    await writeJson(join(root, 'home', 'parameters.json'), {
      Design: 'gcd',
      'Top module': 'gcd',
      PDK: 'ics55',
    })
    await writeJson(join(root, 'home', 'flow.json'), {
      steps: [{ name: 'Synthesis', tool: 'yosys', state: 'Success', runtime: '', info: {} }],
    })
    await writeJson(join(root, 'home', 'home.json'), {})

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const index = await service.getIndex()
    const resources = index.flow.steps[0].resources

    expect(resources.output.fixed_verilog).toMatchObject({
      path: join(root, 'Synthesis_yosys', 'output', 'gcd_Synthesis_fixed.v'),
      kind: 'output',
    })
    expect(resources.output.fixedVerilog).toBeUndefined()
    expect(resources.feature.generic_stat).toMatchObject({
      path: join(root, 'Synthesis_yosys', 'feature', 'Synthesis_generic_stat.json'),
      kind: 'analysis',
    })
    expect(resources.feature.genericStat).toBeUndefined()
  })

  it('resolves yosys analysis from planned metrics, feature, and report paths', async () => {
    const root = await tempWorkspace()
    await mkdir(join(root, 'home'), { recursive: true })
    await mkdir(join(root, 'Synthesis_yosys', 'analysis'), { recursive: true })
    await mkdir(join(root, 'Synthesis_yosys', 'feature'), { recursive: true })
    await mkdir(join(root, 'Synthesis_yosys', 'report'), { recursive: true })
    await writeJson(join(root, 'home', 'parameters.json'), {
      Design: 'gcd',
      'Top module': 'gcd',
      PDK: 'ics55',
    })
    await writeJson(join(root, 'home', 'flow.json'), {
      steps: [{ name: 'Synthesis', tool: 'yosys', state: 'Success', runtime: '', info: {} }],
    })
    await writeJson(join(root, 'home', 'home.json'), {})
    await writeFile(join(root, 'Synthesis_yosys', 'analysis', 'Synthesis_metrics.json'), '{}', 'utf8')
    await writeFile(join(root, 'Synthesis_yosys', 'feature', 'Synthesis_stat.json'), '{}', 'utf8')
    await writeFile(join(root, 'Synthesis_yosys', 'report', 'Synthesis_stat.json'), '{}', 'utf8')
    await writeFile(join(root, 'Synthesis_yosys', 'report', 'Synthesis_check.rpt'), 'ok', 'utf8')

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: 'synthesis', id: 'analysis' })

    expect(result).toMatchObject({
      step: 'Synthesis',
      id: 'analysis',
      response: 'available',
      info: {
        metrics: join(root, 'Synthesis_yosys', 'analysis', 'Synthesis_metrics.json'),
        'data summary': join(root, 'Synthesis_yosys', 'feature', 'Synthesis_stat.json'),
        'step report': {
          stat: join(root, 'Synthesis_yosys', 'report', 'Synthesis_stat.json'),
          check: join(root, 'Synthesis_yosys', 'report', 'Synthesis_check.rpt'),
        },
      },
      missing: [],
    })
    expect(result.info['data summary']).not.toBe(
      join(root, 'Synthesis_yosys', 'analysis', 'Synthesis_summary.json'),
    )
  })

  it('marks the index missing when parameters or flow files are absent', async () => {
    const root = await tempWorkspace()
    await mkdir(join(root, 'home'), { recursive: true })

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const index = await service.getIndex()

    expect(index.status).toBe('missing')
    expect(index.parameters).toBeNull()
    expect(index.flow.steps).toEqual([])
    expect(index.messages).toEqual(expect.arrayContaining([
      `Missing workspace parameters: ${join(root, 'home', 'parameters.json')}`,
      `Missing workspace flow: ${join(root, 'home', 'flow.json')}`,
    ]))
  })

  it('marks the index error when workspace JSON is malformed', async () => {
    const root = await tempWorkspace()
    await mkdir(join(root, 'home'), { recursive: true })
    await writeFile(join(root, 'home', 'parameters.json'), '{', 'utf8')
    await writeJson(join(root, 'home', 'flow.json'), { steps: [] })

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const index = await service.getIndex()

    expect(index.status).toBe('error')
    expect(index.messages.join('\n')).toContain('Failed to parse')
  })
})
