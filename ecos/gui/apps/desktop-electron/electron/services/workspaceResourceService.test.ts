import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceResourceFile } from '@ecos-studio/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceResourceService } from './workspaceResourceService'

const tempDirectories: string[] = []
type ProjectScopeProviderDouble = ConstructorParameters<
  typeof WorkspaceResourceService
>[0]['projectScopeProvider']

function isWorkspaceResourceFile(value: unknown): value is WorkspaceResourceFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'exists' in value &&
    typeof value.exists === 'boolean'
  )
}

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
  steps: Array<{
    name: string
    tool: string
    state?: string
    runtime?: string
    info?: Record<string, unknown>
  }>,
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
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
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
      steps: [
        { name: 'place', tool: 'ecc', state: 'Success', runtime: '00:00:01', info: {} },
      ],
    })
    await writeJson(join(root, 'home', 'home.json'), {
      flow: join(root, 'home', 'flow.json'),
    })
    await writeFile(join(root, 'place_ecc', 'output', 'gcd_place.json'), '{}', 'utf8')
    await writeFile(join(root, 'place_ecc', 'output', 'gcd_place.png'), 'png', 'utf8')
    await writeFile(join(root, 'place_ecc', 'analysis', 'qor_metrics.json'), '{}', 'utf8')

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

  it('discovers every file below a step report directory', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'sta', tool: 'ecc' }])
    const reportDirectory = join(root, 'sta_ecc', 'report')
    await mkdir(join(reportDirectory, 'MAX_125', 'Cworst'), { recursive: true })
    await writeFile(join(reportDirectory, 'sta.db.rpt'), 'summary', 'utf8')
    await writeFile(
      join(reportDirectory, 'MAX_125', 'Cworst', 'timing_max.rpt'),
      'timing',
      'utf8',
    )
    await writeFile(
      join(reportDirectory, 'MAX_125', 'Cworst', 'summary.json'),
      '{}',
      'utf8',
    )

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const index = await service.getIndex()
    const reports = Object.values(index.flow.steps[0]!.resources.report).flatMap(
      (resource) =>
        isWorkspaceResourceFile(resource)
          ? [resource]
          : Object.values(resource).filter(isWorkspaceResourceFile),
    )

    expect(
      reports.filter((resource) => resource.exists).map((resource) => resource.path),
    ).toEqual(
      expect.arrayContaining([
        join(reportDirectory, 'sta.db.rpt'),
        join(reportDirectory, 'MAX_125', 'Cworst', 'timing_max.rpt'),
        join(reportDirectory, 'MAX_125', 'Cworst', 'summary.json'),
      ]),
    )
  })

  it('uses the sizer workspace directory convention for steps with spaces', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [
      { name: 'Timing optimization', tool: 'sizer', state: 'Incomplete' },
    ])
    await mkdir(join(root, 'timing_optimization_sizer', 'log'), { recursive: true })
    await writeFile(
      join(root, 'timing_optimization_sizer', 'log', 'Timing optimization.log'),
      'sizer log',
      'utf8',
    )

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const index = await service.getIndex()

    expect(index.flow.steps[0].directory).toBe(join(root, 'timing_optimization_sizer'))
    expect(index.flow.steps[0].resources.log.file).toMatchObject({
      path: join(root, 'timing_optimization_sizer', 'log', 'Timing optimization.log'),
      exists: true,
      kind: 'log',
    })
  })

  it('exposes workspace-level view package tech resources from the design view directory', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'place', tool: 'ecc' }])
    await mkdir(join(root, 'gcd_view', 'tech'), { recursive: true })
    await writeJson(join(root, 'gcd_view', 'manifest.json'), {
      schema: 'ecc.view.v1',
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
      schema: 'ecc.view.v1',
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
      schema: 'ecc.view.v1',
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

  it('returns resolveStepInfo(layout) with missing native-render inputs instead of throwing', async () => {
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
        db: join(root, 'route_ecc', 'output', 'gcd_route_db'),
        def: join(root, 'route_ecc', 'output', 'gcd_route.def.gz'),
        gds: join(root, 'route_ecc', 'output', 'gcd_route.gds'),
        image: join(root, 'route_ecc', 'output', 'gcd_route.png'),
        json: join(root, 'route_ecc', 'output', 'gcd_route.json'),
      },
    })
    expect(result.missing).toEqual(
      expect.arrayContaining([
        join(root, 'route_ecc', 'output', 'gcd_route.png'),
        join(root, 'route_ecc', 'output', 'gcd_route.def.gz'),
        join(root, 'route_ecc', 'output', 'gcd_route.gds'),
        join(root, 'route_ecc', 'output', 'gcd_route_db'),
      ]),
    )
    expect(result.missing).not.toContain(
      join(root, 'route_ecc', 'output', 'gcd_route.json'),
    )
  })

  it('does not require the legacy step view JSON package for layout info', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'place', tool: 'dreamplace' }])
    await mkdir(join(root, 'place_dreamplace', 'output', 'gcd_place_db'), {
      recursive: true,
    })
    await writeFile(join(root, 'place_dreamplace', 'output', 'gcd_place.def.gz'), 'def')
    await writeFile(join(root, 'place_dreamplace', 'output', 'gcd_place.gds'), 'gds')
    await writeFile(join(root, 'place_dreamplace', 'output', 'gcd_place.png'), 'png')

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: 'place', id: 'layout' })

    expect(result).toMatchObject({
      step: 'place',
      id: 'layout',
      response: 'available',
      info: {
        db: join(root, 'place_dreamplace', 'output', 'gcd_place_db'),
        def: join(root, 'place_dreamplace', 'output', 'gcd_place.def.gz'),
        gds: join(root, 'place_dreamplace', 'output', 'gcd_place.gds'),
        image: join(root, 'place_dreamplace', 'output', 'gcd_place.png'),
        viewJson: join(root, 'place_dreamplace', 'output', 'gcd_place_view'),
        geometryManifest: join(
          root,
          'place_dreamplace',
          'output',
          'geometry',
          'geometry.manifest',
        ),
      },
    })
    expect(result.missing).toEqual([])
    expect(result.missing).not.toContain(
      join(root, 'place_dreamplace', 'output', 'gcd_place_view'),
    )
  })

  it.each([
    ['Floorplan', 'ecc'],
    ['fixFanout', 'ecc'],
    ['place', 'dreamplace'],
    ['CTS', 'ecc'],
    ['legalization', 'dreamplace'],
    ['route', 'ecc'],
    ['drc', 'ecc'],
    ['filler', 'ecc'],
    ['RCX', 'ecc'],
  ])('marks %s layout available from native renderer inputs', async (stepName, tool) => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: stepName, tool }])
    const stepDirectory = join(root, `${stepName}_${tool}`)
    const outputDirectory = join(stepDirectory, 'output')
    await mkdir(join(outputDirectory, `gcd_${stepName}_db`), { recursive: true })
    await writeFile(join(outputDirectory, `gcd_${stepName}.def.gz`), 'def')
    await writeFile(join(outputDirectory, `gcd_${stepName}.gds`), 'gds')
    await writeFile(join(outputDirectory, `gcd_${stepName}.png`), 'png')

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: stepName, id: 'layout' })

    expect(result).toMatchObject({
      step: stepName,
      id: 'layout',
      response: 'available',
      info: {
        db: join(outputDirectory, `gcd_${stepName}_db`),
        def: join(outputDirectory, `gcd_${stepName}.def.gz`),
        gds: join(outputDirectory, `gcd_${stepName}.gds`),
        image: join(outputDirectory, `gcd_${stepName}.png`),
      },
      missing: [],
    })
  })

  it('resolves Harden preview and subflow resources from the ECC step directory', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'Harden', tool: 'ecc' }])
    await mkdir(join(root, 'Harden_ecc', 'output'), { recursive: true })
    await writeFile(join(root, 'Harden_ecc', 'output', 'gcd_Harden.png'), 'png', 'utf8')
    await writeJson(join(root, 'Harden_ecc', 'subflow.json'), {
      path: join(root, 'Harden_ecc', 'subflow.json'),
      steps: [{ name: 'run harden', state: 'Success' }],
    })

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })

    await expect(
      service.resolveStepInfo({ step: 'harden', id: 'layout' }),
    ).resolves.toMatchObject({
      step: 'Harden',
      response: 'missing',
      info: {
        image: join(root, 'Harden_ecc', 'output', 'gcd_Harden.png'),
      },
    })
    await expect(
      service.resolveStepInfo({ step: 'Harden', id: 'subflow' }),
    ).resolves.toMatchObject({
      step: 'Harden',
      response: 'available',
      info: {
        path: join(root, 'Harden_ecc', 'subflow.json'),
      },
    })
  })

  it('does not expose configuration for Synthesis even when flow_config.json exists', async () => {
    const root = await tempWorkspace()
    await writeWorkspace(root, [{ name: 'Synthesis', tool: 'yosys' }])
    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(join(root, 'config', 'flow_config.json'), '{}', 'utf8')

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: 'synthesis', id: 'config' })

    expect(result).toMatchObject({
      step: 'Synthesis',
      response: 'available',
      info: {},
      missing: [],
    })
    expect(result.info.path).toBeUndefined()
    expect(result.info.config).toBeUndefined()
  })

  it.each([
    ['Floorplan', 'fp_default_config.json'],
    ['fixFanout', 'no_default_config_fixfanout.json'],
    ['place', 'pl_default_config.json'],
    ['CTS', 'cts_default_config.json'],
    ['legalization', 'pl_default_config.json'],
    ['route', 'rt_default_config.json'],
    ['drc', 'drc_default_config.json'],
    ['filler', 'pl_default_config.json'],
    ['RCX', 'rcx.json'],
    ['sta', 'sta.json'],
    ['db', 'db_default_config.json'],
  ])(
    'maps ECC %s config to the workspace config directory',
    async (stepName, configFile) => {
      const root = await tempWorkspace()
      await writeWorkspace(root, [{ name: stepName, tool: 'ecc' }])
      await mkdir(join(root, 'config'), { recursive: true })
      await writeFile(join(root, 'config', configFile), '{}', 'utf8')

      const service = new WorkspaceResourceService({
        projectScopeProvider: provider(root),
      })
      const result = await service.resolveStepInfo({
        step: stepName.toLowerCase(),
        id: 'config',
      })

      expect(result).toMatchObject({
        step: stepName,
        response: 'available',
        info: { config: join(root, 'config', configFile) },
        missing: [],
      })
    },
  )

  it.each([
    ['Timing optimization', []],
    ['Signoff', []],
    ['Harden', ['sta.json']],
  ])(
    'does not expose configuration for ECC %s even when unrelated config files exist',
    async (stepName, extraConfigFiles) => {
      const root = await tempWorkspace()
      await writeWorkspace(root, [{ name: stepName, tool: 'ecc' }])
      await mkdir(join(root, 'config'), { recursive: true })
      await writeFile(
        join(root, 'config', 'flow_config.json'),
        '{"ConfigPath":{}}',
        'utf8',
      )
      await Promise.all(
        extraConfigFiles.map((filename) =>
          writeFile(join(root, 'config', filename), '{}', 'utf8'),
        ),
      )

      const service = new WorkspaceResourceService({
        projectScopeProvider: provider(root),
      })
      const result = await service.resolveStepInfo({
        step: stepName,
        id: 'config',
      })

      expect(result).toMatchObject({
        step: stepName,
        response: 'available',
        missing: [],
      })
      expect(result.info.config).toBeUndefined()
      expect(result.info.path).toBeUndefined()
    },
  )

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
    await writeFile(
      join(root, 'place_ecc', 'feature', 'density_map', 'cell_density.png'),
      'png',
      'utf8',
    )
    await writeFile(
      join(root, 'place_ecc', 'feature', 'density_map', 'rudy-horizontal.png'),
      'png',
      'utf8',
    )
    await writeFile(
      join(root, 'place_ecc', 'feature', 'density_map', 'notes.txt'),
      'ignore',
      'utf8',
    )

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
    expect(result.message).toEqual(
      expect.arrayContaining([
        `Workspace step not found: place`,
        `Missing workspace parameters: ${join(root, 'home', 'parameters.json')}`,
        `Missing workspace flow: ${join(root, 'home', 'flow.json')}`,
      ]),
    )
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
      steps: [
        { name: 'Synthesis', tool: 'yosys', state: 'Success', runtime: '', info: {} },
      ],
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
      steps: [
        { name: 'Synthesis', tool: 'yosys', state: 'Success', runtime: '', info: {} },
      ],
    })
    await writeJson(join(root, 'home', 'home.json'), {})
    await writeFile(
      join(root, 'Synthesis_yosys', 'analysis', 'qor_metrics.json'),
      '{}',
      'utf8',
    )
    await writeFile(
      join(root, 'Synthesis_yosys', 'feature', 'Synthesis_stat.json'),
      '{}',
      'utf8',
    )
    await writeFile(
      join(root, 'Synthesis_yosys', 'report', 'Synthesis_stat.json'),
      '{}',
      'utf8',
    )
    await writeFile(
      join(root, 'Synthesis_yosys', 'report', 'Synthesis_check.rpt'),
      'ok',
      'utf8',
    )

    const service = new WorkspaceResourceService({ projectScopeProvider: provider(root) })
    const result = await service.resolveStepInfo({ step: 'synthesis', id: 'analysis' })

    expect(result).toMatchObject({
      step: 'Synthesis',
      id: 'analysis',
      response: 'available',
      info: {
        metrics: join(root, 'Synthesis_yosys', 'analysis', 'qor_metrics.json'),
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
    expect(index.messages).toEqual(
      expect.arrayContaining([
        `Missing workspace parameters: ${join(root, 'home', 'parameters.json')}`,
        `Missing workspace flow: ${join(root, 'home', 'flow.json')}`,
      ]),
    )
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
