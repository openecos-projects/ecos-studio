import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  WorkspaceResourceFile,
  WorkspaceResourceIndex,
  WorkspaceResourceStatus,
  WorkspaceStepInfoRequest,
  WorkspaceStepInfoResult,
  WorkspaceStepResource,
  WorkspaceTechResources,
} from '@ecos-studio/shared'
import type { ProjectScopeProvider } from './workspaceService'

type WorkspaceResourceFileKind = WorkspaceResourceFile['kind']
type ResourceBucketName = keyof WorkspaceStepResource['resources']
type StepFileBuckets = WorkspaceStepResource['resources']

interface WorkspaceResourceServiceOptions {
  projectScopeProvider: Pick<ProjectScopeProvider, 'getProjectRoot' | 'requestProjectPathAccess'>
}

interface FlowStepInput {
  name: string
  tool: string
  state: string
  runtime: string
  info: Record<string, unknown>
}

interface IndexBuildResult {
  index: WorkspaceResourceIndex
  statErrors: string[]
}

interface StepInfoBuildResult {
  info: Record<string, unknown>
  errors: string[]
}

export class WorkspaceResourceService {
  private readonly projectScopeProvider: WorkspaceResourceServiceOptions['projectScopeProvider']

  constructor(options: WorkspaceResourceServiceOptions) {
    this.projectScopeProvider = options.projectScopeProvider
  }

  async getIndex(): Promise<WorkspaceResourceIndex> {
    const { index } = await this.buildIndex()
    return index
  }

  async readHome(): Promise<Record<string, unknown> | null> {
    return await this.readJsonOrNull(join(await this.projectScopeProvider.getProjectRoot(), 'home', 'home.json'))
  }

  async readFlow(): Promise<Record<string, unknown> | null> {
    return await this.readJsonOrNull(join(await this.projectScopeProvider.getProjectRoot(), 'home', 'flow.json'))
  }

  async readParameters(): Promise<Record<string, unknown> | null> {
    return await this.readJsonOrNull(
      join(await this.projectScopeProvider.getProjectRoot(), 'home', 'parameters.json'),
    )
  }

  async resolveStepInfo(request: WorkspaceStepInfoRequest): Promise<WorkspaceStepInfoResult> {
    try {
      const { index, statErrors } = await this.buildIndex()
      if (index.status === 'error') {
        return {
          step: request.step,
          id: request.id,
          response: 'error',
          info: {},
          missing: [],
          message: index.messages,
        }
      }

      const step = index.flow.steps.find((candidate) =>
        candidate.name.toLowerCase() === request.step.toLowerCase(),
      )
      if (!step) {
        return {
          step: request.step,
          id: request.id,
          response: 'missing',
          info: {},
          missing: [],
          message: [`Workspace step not found: ${request.step}`, ...index.messages],
        }
      }

      const stepInfoResult = await this.buildStepInfoResponse(request.id, step)
      const info = stepInfoResult.info
      const requiredFiles = this.requiredFilesForStepInfo(request.id, step)
      const missing = requiredFiles.filter((file) => !file.exists).map((file) => file.path)
      const messages = [...statErrors, ...stepInfoResult.errors]
      const response = messages.length > 0 ? 'error' : missing.length > 0 ? 'missing' : 'available'

      return {
        step: step.name,
        id: request.id,
        response,
        info,
        missing,
        message: messages,
      }
    } catch (error) {
      return {
        step: request.step,
        id: request.id,
        response: 'error',
        info: {},
        missing: [],
        message: [formatErrorMessage('Failed to resolve workspace step info', error)],
      }
    }
  }

  private async buildIndex(): Promise<IndexBuildResult> {
    const root = await this.projectScopeProvider.getProjectRoot()
    const messages: string[] = []
    const statErrors: string[] = []
    const homePath = join(root, 'home', 'home.json')
    const flowPath = join(root, 'home', 'flow.json')
    const parametersPath = join(root, 'home', 'parameters.json')
    const checklistPath = join(root, 'home', 'checklist.json')

    const [homeJson, flowJson, parametersJson, checklistJson] = await Promise.all([
      this.describeFile(homePath, 'home', statErrors),
      this.describeFile(flowPath, 'flow', statErrors),
      this.describeFile(parametersPath, 'parameters', statErrors),
      this.describeFile(checklistPath, 'checklist', statErrors),
    ])

    const homeData = await this.readJsonForIndex(homePath, messages)
    const parameters = await this.readJsonForIndex(parametersPath, messages)
    const flowData = await this.readJsonForIndex(flowPath, messages)

    if (!parametersJson.exists) messages.push(`Missing workspace parameters: ${parametersPath}`)
    if (!flowJson.exists) messages.push(`Missing workspace flow: ${flowPath}`)

    const design = stringValue(parameters, 'Design')
    const topModule = stringValue(parameters, 'Top module')
    const pdk = stringValue(parameters, 'PDK')
    const steps = isRecord(flowData) && Array.isArray(flowData.steps)
      ? flowData.steps.map(readFlowStep).filter((step): step is FlowStepInput => step !== null)
      : []
    const flowSteps = await Promise.all(
      steps.map((step) => this.buildStepResource(root, design, topModule, step, statErrors)),
    )
    const tech = await this.discoverTechResources(root, design, flowSteps, statErrors)
    const status = resolveIndexStatus({
      messages,
      statErrors,
      parametersExists: parametersJson.exists,
      flowExists: flowJson.exists,
    })

    return {
      index: {
        root,
        design,
        topModule,
        pdk,
        home: {
          homeJson,
          flowJson,
          parametersJson,
          checklistJson,
        },
        homeData,
        parameters,
        flow: {
          steps: flowSteps,
        },
        ...(tech ? { tech } : {}),
        status,
        messages: [...messages, ...statErrors],
      },
      statErrors,
    }
  }

  private async buildStepResource(
    root: string,
    design: string,
    topModule: string,
    step: FlowStepInput,
    errors: string[],
  ): Promise<WorkspaceStepResource> {
    const tool = step.tool || 'unknown'
    const directory = join(root, `${step.name}_${tool}`)
    const resources = createEmptyBuckets()
    const toolKey = tool.toLowerCase()

    if (toolKey === 'yosys') {
      addYosysResources(resources, root, directory, design, step.name)
    } else if (toolKey === 'ecc') {
      addEccLikeResources(resources, root, directory, design, topModule, step.name)
    } else if (toolKey === 'dreamplace') {
      addEccLikeResources(resources, root, directory, design, topModule, step.name)
      resources.config.dreamplace = createFile(join(root, 'config', 'dreamplace.json'), 'config')
    } else {
      addUnknownResources(resources, directory, step.name)
    }

    await this.describeBuckets(resources, errors)

    return {
      name: step.name,
      tool,
      state: step.state,
      runtime: step.runtime,
      directory,
      info: step.info,
      resources,
    }
  }

  private async discoverTechResources(
    root: string,
    design: string,
    flowSteps: WorkspaceStepResource[],
    errors: string[],
  ): Promise<WorkspaceTechResources | undefined> {
    if (!design) return undefined

    const candidateRoots = uniqueStrings([
      join(root, `${design}_view`),
      ...flowSteps.map((step) => join(step.directory, 'output', `${design}_${step.name}_view`)),
    ])

    for (const packageRoot of candidateRoots) {
      const tech = await this.describeTechPackage(packageRoot, errors)
      if (tech) return tech
    }

    return undefined
  }

  private async describeTechPackage(
    packageRoot: string,
    errors: string[],
  ): Promise<WorkspaceTechResources | undefined> {
    const manifestPath = join(packageRoot, 'manifest.json')
    const manifest = await this.describeFile(manifestPath, 'tech-json', errors)
    if (!manifest.exists) return undefined

    const manifestJson = await this.readJsonForIndex(manifestPath, errors)
    const files = isRecord(manifestJson?.files) ? manifestJson.files : {}
    const filePath = (key: string, fallback: string): string => {
      const value = files[key]
      return typeof value === 'string' && value.length > 0 ? value : fallback
    }

    const metaPath = filePath('meta', 'meta.json')
    const meta = await this.describeFile(join(packageRoot, metaPath), 'tech-json', errors)
    const [layers, sites, vias, cellMasters] = await Promise.all([
      this.describeFile(join(packageRoot, filePath('layers', 'tech/layers.json')), 'tech-json', errors),
      this.describeFile(join(packageRoot, filePath('sites', 'tech/sites.json')), 'tech-json', errors),
      this.describeFile(join(packageRoot, filePath('vias', 'tech/vias.json')), 'tech-json', errors),
      this.describeFile(join(packageRoot, filePath('cell_masters', 'tech/cell_masters.json')), 'tech-json', errors),
    ])

    return {
      packageRoot,
      source: 'view-package',
      manifest,
      ...(meta.exists ? { meta } : {}),
      layers,
      sites,
      vias,
      cellMasters,
    }
  }

  private async describeBuckets(resources: StepFileBuckets, errors: string[]): Promise<void> {
    const files = collectFiles(resources)
    await Promise.all(files.map(async (file) => {
      const described = await this.describeFile(file.path, file.kind, errors)
      Object.assign(file, described)
    }))
  }

  private async describeFile(
    path: string,
    kind: WorkspaceResourceFileKind,
    errors: string[],
  ): Promise<WorkspaceResourceFile> {
    try {
      const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
      const fileStats = await stat(canonicalPath)
      return {
        path: canonicalPath,
        exists: true,
        kind,
        sizeBytes: fileStats.size,
        mtimeMs: fileStats.mtimeMs,
      }
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        return { path, exists: false, kind }
      }

      errors.push(formatErrorMessage(`Failed to stat workspace resource: ${path}`, error))
      return { path, exists: false, kind }
    }
  }

  private async readJsonForIndex(
    path: string,
    messages: string[],
  ): Promise<Record<string, unknown> | null> {
    try {
      return await this.readJsonOrNull(path)
    } catch (error) {
      messages.push(formatErrorMessage(`Failed to parse workspace JSON: ${path}`, error))
      return null
    }
  }

  private async readJsonOrNull(path: string): Promise<Record<string, unknown> | null> {
    try {
      const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
      const raw = await readFile(canonicalPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      return isRecord(parsed) ? parsed : {}
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        return null
      }

      throw error
    }
  }

  private async buildStepInfoResponse(
    id: WorkspaceStepInfoRequest['id'],
    step: WorkspaceStepResource,
  ): Promise<StepInfoBuildResult> {
    switch (id) {
      case 'layout':
        return stepInfo({
          image: step.resources.output.image?.path,
          json: step.resources.output.json?.path,
          viewJson: step.resources.output.viewJson?.path,
        })
      case 'views':
        return stepInfo({
          image: step.resources.output.image?.path,
          json: step.resources.output.json?.path,
          metrics: step.resources.analysis.metrics?.path,
          information: {},
        })
      case 'metrics':
        return stepInfo({ metrics: step.resources.analysis.metrics?.path })
      case 'subflow':
        return stepInfo({ path: step.resources.subflow.path?.path })
      case 'analysis':
        return stepInfo(buildAnalysisInfo(step))
      case 'checklist':
        return stepInfo({ path: step.resources.checklist.path?.path })
      case 'config':
        return stepInfo(buildConfigInfo(step))
      case 'maps':
        return await this.buildDensityMapInfo(step)
      case 'sta':
        return stepInfo({ sta: nestedResourcePaths(step.resources.report.sta) })
    }
  }

  private async buildDensityMapInfo(step: WorkspaceStepResource): Promise<StepInfoBuildResult> {
    const directory = join(step.directory, 'feature', 'density_map')

    try {
      const canonicalDirectory = await this.projectScopeProvider.requestProjectPathAccess(directory)
      const entries = await readdir(canonicalDirectory, { withFileTypes: true })
      const pngEntries = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
        .sort((a, b) => a.name.localeCompare(b.name))

      return stepInfo(Object.fromEntries(
        pngEntries.map((entry) => [
          stripPngExtension(entry.name),
          {
            path: join(canonicalDirectory, entry.name),
            info: [],
          },
        ]),
      ))
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) return stepInfo({})

      return {
        info: {},
        errors: [formatErrorMessage(`Failed to read workspace density maps: ${directory}`, error)],
      }
    }
  }

  private requiredFilesForStepInfo(
    id: WorkspaceStepInfoRequest['id'],
    step: WorkspaceStepResource,
  ): WorkspaceResourceFile[] {
    switch (id) {
      case 'layout':
        return existingResourceRefs([
          step.resources.output.image,
          step.resources.output.json,
          step.resources.output.viewJson,
        ])
      case 'views':
        return existingResourceRefs([
          step.resources.output.image,
          step.resources.output.json,
          step.resources.analysis.metrics,
        ])
      case 'metrics':
        return existingResourceRefs([step.resources.analysis.metrics])
      case 'subflow':
        return existingResourceRefs([step.resources.subflow.path])
      case 'analysis':
        return analysisFiles(step)
      case 'checklist':
        return existingResourceRefs([step.resources.checklist.path])
      case 'config':
        return configFiles(step)
      case 'maps':
        return []
      case 'sta':
        return resourceRecordValues(step.resources.report.sta)
    }
  }
}

function createFile(path: string, kind: WorkspaceResourceFileKind): WorkspaceResourceFile {
  return { path, exists: false, kind }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function createEmptyBuckets(): StepFileBuckets {
  return {
    output: {},
    data: {},
    feature: {},
    report: {},
    log: {},
    script: {},
    analysis: {},
    subflow: {},
    checklist: {},
    config: {},
  }
}

function addEccLikeResources(
  resources: StepFileBuckets,
  root: string,
  directory: string,
  design: string,
  topModule: string,
  stepName: string,
): void {
  resources.output.dir = createFile(join(directory, 'output'), 'output')
  resources.output.def = createFile(join(directory, 'output', `${design}_${stepName}.def.gz`), 'output')
  resources.output.verilog = createFile(join(directory, 'output', `${design}_${stepName}.v`), 'output')
  resources.output.gds = createFile(join(directory, 'output', `${design}_${stepName}.gds`), 'output')
  resources.output.db = createFile(join(directory, 'output', `${design}_${stepName}_db`), 'output')
  resources.output.image = createFile(join(directory, 'output', `${design}_${stepName}.png`), 'layout-image')
  resources.output.json = createFile(join(directory, 'output', `${design}_${stepName}.json`), 'layout-json')
  resources.output.viewJson = createFile(join(directory, 'output', `${design}_${stepName}_view`), 'view-json')
  resources.output.lef = createFile(join(directory, 'output', `${design}_${stepName}.lef`), 'output')
  resources.output.lib = createFile(join(directory, 'output', `${design}_${stepName}.lib`), 'output')
  resources.data.dir = createFile(join(directory, 'data'), 'unknown')
  resources.data.sta = createFile(join(directory, 'data', 'sta'), 'unknown')
  resources.feature.dir = createFile(join(directory, 'feature'), 'analysis')
  resources.feature.db = createFile(join(directory, 'feature', `${stepName}.db.json`), 'analysis')
  resources.feature.step = createFile(join(directory, 'feature', `${stepName}.step.json`), 'analysis')
  resources.feature.map = createFile(join(directory, 'feature', `${stepName}.map.json`), 'analysis')
  resources.feature.timing = createFile(join(directory, 'data', 'sta', `${topModule}.rpt.json`), 'analysis')
  resources.report.dir = createFile(join(directory, 'report'), 'report')
  resources.report.db = createFile(join(directory, 'report', `${stepName}.db.rpt`), 'report')
  resources.report.step = createFile(join(directory, 'report', `${stepName}.rpt`), 'report')
  resources.report.sta = {
    timing: createFile(join(directory, 'data', 'sta', `${topModule}.rpt`), 'report'),
    hold: createFile(join(directory, 'data', 'sta', `${topModule}_hold.skew`), 'report'),
    setup: createFile(join(directory, 'data', 'sta', `${topModule}_setup.skew`), 'report'),
    cap: createFile(join(directory, 'data', 'sta', `${topModule}.cap`), 'report'),
    fanout: createFile(join(directory, 'data', 'sta', `${topModule}.fanout`), 'report'),
    trans: createFile(join(directory, 'data', 'sta', `${topModule}.trans`), 'report'),
  }
  resources.log.file = createFile(join(directory, 'log', `${stepName}.log`), 'log')
  resources.script.main = createFile(join(directory, 'script', `${stepName}_main.tcl`), 'script')
  resources.analysis.metrics = createFile(join(directory, 'analysis', `${stepName}_metrics.json`), 'metrics')
  resources.analysis.statis_csv = createFile(join(directory, 'analysis', `${stepName}_statis.csv`), 'analysis')
  resources.subflow.path = createFile(join(directory, 'subflow.json'), 'subflow')
  resources.checklist.path = createFile(join(directory, 'checklist.json'), 'checklist')
  addEccConfigResources(resources, root, stepName)
}

function addYosysResources(
  resources: StepFileBuckets,
  root: string,
  directory: string,
  design: string,
  stepName: string,
): void {
  resources.output.dir = createFile(join(directory, 'output'), 'output')
  resources.output.def = createFile(join(directory, 'output', `${design}_${stepName}.def.gz`), 'output')
  resources.output.verilog = createFile(join(directory, 'output', `${design}_${stepName}.v`), 'output')
  resources.output.fixed_verilog = createFile(join(directory, 'output', `${design}_${stepName}_fixed.v`), 'output')
  resources.output.json = createFile(join(directory, 'output', `${design}_${stepName}.json`), 'layout-json')
  resources.output.report = createFile(join(directory, 'output', `${design}_${stepName}.rpt`), 'report')
  resources.output.image = createFile(join(directory, 'output', `${design}_${stepName}.png`), 'layout-image')
  resources.feature.generic_stat = createFile(join(directory, 'feature', `${stepName}_generic_stat.json`), 'analysis')
  resources.feature.stat = createFile(join(directory, 'feature', `${stepName}_stat.json`), 'analysis')
  resources.report.stat = createFile(join(directory, 'report', `${stepName}_stat.json`), 'report')
  resources.report.check = createFile(join(directory, 'report', `${stepName}_check.rpt`), 'report')
  resources.log.file = createFile(join(directory, 'log', `${stepName}.log`), 'log')
  resources.script.main = createFile(join(directory, 'script', `${stepName}_main.tcl`), 'script')
  resources.analysis.metrics = createFile(join(directory, 'analysis', `${stepName}_metrics.json`), 'metrics')
  resources.subflow.path = createFile(join(directory, 'subflow.json'), 'subflow')
  resources.checklist.path = createFile(join(directory, 'checklist.json'), 'checklist')
  resources.config.path = createFile(join(root, 'config', 'flow_config.json'), 'config')
}

function addEccConfigResources(
  resources: StepFileBuckets,
  root: string,
  stepName: string,
): void {
  resources.config.dir = createFile(join(root, 'config'), 'config')
  resources.config.flow = createFile(join(root, 'config', 'flow_config.json'), 'config')
  resources.config.db = createFile(join(root, 'config', 'db_default_config.json'), 'config')
  resources.config.cts = createFile(join(root, 'config', 'cts_default_config.json'), 'config')
  resources.config.drc = createFile(join(root, 'config', 'drc_default_config.json'), 'config')
  resources.config.floorplan = createFile(join(root, 'config', 'fp_default_config.json'), 'config')
  resources.config.netlist_opt = createFile(join(root, 'config', 'no_default_config_fixfanout.json'), 'config')
  resources.config.placement = createFile(join(root, 'config', 'pl_default_config.json'), 'config')
  resources.config.pnp = createFile(join(root, 'config', 'pnp_default_config.json'), 'config')
  resources.config.routing = createFile(join(root, 'config', 'rt_default_config.json'), 'config')
  resources.config.rcx = createFile(join(root, 'config', 'rcx.json'), 'config')
  resources.config.timing_opt_drv = createFile(join(root, 'config', 'to_default_config_drv.json'), 'config')
  resources.config.timing_opt_hold = createFile(join(root, 'config', 'to_default_config_hold.json'), 'config')
  resources.config.timing_opt_setup = createFile(join(root, 'config', 'to_default_config_setup.json'), 'config')
  resources.config.legalization = createFile(join(root, 'config', 'pl_default_config.json'), 'config')
  resources.config.filler = createFile(join(root, 'config', 'pl_default_config.json'), 'config')
  resources.config.config = configResourceForEccStep(resources.config, stepName)
}

function configResourceForEccStep(
  config: StepFileBuckets['config'],
  stepName: string,
): WorkspaceResourceFile {
  switch (stepName.toLowerCase()) {
    case 'floorplan':
      return config.floorplan ?? config.flow
    case 'place':
      return config.placement ?? config.flow
    case 'cts':
      return config.cts ?? config.flow
    case 'route':
      return config.routing ?? config.flow
    case 'drc':
      return config.drc ?? config.flow
    case 'fixfanout':
      return config.netlist_opt ?? config.flow
    case 'optdrv':
      return config.timing_opt_drv ?? config.flow
    case 'opthold':
      return config.timing_opt_hold ?? config.flow
    case 'optsetup':
      return config.timing_opt_setup ?? config.flow
    case 'pnp':
      return config.pnp ?? config.flow
    case 'rcx':
      return config.rcx ?? config.flow
    case 'db':
      return config.db ?? config.flow
    default:
      return config.flow
  }
}

function addUnknownResources(
  resources: StepFileBuckets,
  directory: string,
  stepName: string,
): void {
  resources.output.dir = createFile(join(directory, 'output'), 'output')
  resources.analysis.dir = createFile(join(directory, 'analysis'), 'analysis')
  resources.log.file = createFile(join(directory, 'log', `${stepName}.log`), 'log')
  resources.subflow.path = createFile(join(directory, 'subflow.json'), 'subflow')
  resources.checklist.path = createFile(join(directory, 'checklist.json'), 'checklist')
}

function collectFiles(resources: StepFileBuckets): WorkspaceResourceFile[] {
  return Object.values(resources).flatMap((bucket) => collectBucketFiles(bucket))
}

function collectBucketFiles(
  bucket: Record<string, WorkspaceResourceFile | Record<string, WorkspaceResourceFile>>,
): WorkspaceResourceFile[] {
  return Object.values(bucket).flatMap((value) => {
    if (isWorkspaceResourceFile(value)) return [value]
    return Object.values(value)
  })
}

function isWorkspaceResourceFile(value: unknown): value is WorkspaceResourceFile {
  return isRecord(value) && typeof value.path === 'string' && typeof value.exists === 'boolean'
}

function readFlowStep(value: unknown): FlowStepInput | null {
  if (!isRecord(value)) return null
  const name = typeof value.name === 'string' ? value.name : ''
  if (!name) return null

  return {
    name,
    tool: typeof value.tool === 'string' ? value.tool : 'unknown',
    state: typeof value.state === 'string' ? value.state : '',
    runtime: typeof value.runtime === 'string' ? value.runtime : '',
    info: isRecord(value.info) ? value.info : {},
  }
}

function stringValue(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value : ''
}

function resolveIndexStatus(input: {
  messages: string[]
  statErrors: string[]
  parametersExists: boolean
  flowExists: boolean
}): WorkspaceResourceStatus {
  if (input.messages.some((message) => message.startsWith('Failed to parse')) || input.statErrors.length > 0) {
    return 'error'
  }
  if (!input.parametersExists || !input.flowExists) return 'missing'
  return 'available'
}

function buildAnalysisInfo(step: WorkspaceStepResource): Record<string, unknown> {
  const tool = step.tool.toLowerCase()
  if (tool === 'yosys') {
    return {
      metrics: step.resources.analysis.metrics?.path,
      'data summary': step.resources.feature.stat?.path,
      'step report': {
        stat: nestedResourcePath(step.resources.report, 'stat'),
        check: nestedResourcePath(step.resources.report, 'check'),
      },
    }
  }

  return {
    metrics: step.resources.analysis.metrics?.path,
    statis: step.resources.analysis.statis_csv?.path,
    'data summary': step.resources.feature.db?.path,
    'step feature': step.resources.feature.step?.path,
    'step report': nestedResourcePath(step.resources.report, 'db'),
  }
}

function analysisFiles(step: WorkspaceStepResource): WorkspaceResourceFile[] {
  const tool = step.tool.toLowerCase()
  if (tool === 'yosys') {
    return existingResourceRefs([
      step.resources.analysis.metrics,
      step.resources.feature.stat,
      nestedResource(step.resources.report, 'stat'),
      nestedResource(step.resources.report, 'check'),
    ])
  }

  return existingResourceRefs([
    step.resources.analysis.metrics,
    step.resources.analysis.statis_csv,
    step.resources.feature.db,
    step.resources.feature.step,
    nestedResource(step.resources.report, 'db'),
  ])
}

function buildConfigInfo(step: WorkspaceStepResource): Record<string, unknown> {
  const tool = step.tool.toLowerCase()
  if (tool === 'yosys') return { path: step.resources.config.path?.path }
  if (tool === 'dreamplace') return { config: step.resources.config.dreamplace?.path }
  return { config: step.resources.config.config?.path }
}

function stepInfo(info: Record<string, unknown>): StepInfoBuildResult {
  return { info, errors: [] }
}

function stripPngExtension(filename: string): string {
  return filename.replace(/\.png$/i, '')
}

function configFiles(step: WorkspaceStepResource): WorkspaceResourceFile[] {
  const tool = step.tool.toLowerCase()
  if (tool === 'yosys') return existingResourceRefs([step.resources.config.path])
  if (tool === 'dreamplace') return existingResourceRefs([step.resources.config.dreamplace])
  return existingResourceRefs([step.resources.config.config])
}

function existingResourceRefs(
  files: Array<WorkspaceResourceFile | undefined>,
): WorkspaceResourceFile[] {
  return files.filter((file): file is WorkspaceResourceFile => file !== undefined)
}

function nestedResource(
  bucket: StepFileBuckets[ResourceBucketName],
  key: string,
): WorkspaceResourceFile | undefined {
  const value = bucket[key]
  return isWorkspaceResourceFile(value) ? value : undefined
}

function nestedResourcePath(
  bucket: StepFileBuckets[ResourceBucketName],
  key: string,
): string | undefined {
  return nestedResource(bucket, key)?.path
}

function nestedResourcePaths(value: unknown): Record<string, string> | string | undefined {
  if (isWorkspaceResourceFile(value)) return value.path
  if (!isRecord(value)) return undefined

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, WorkspaceResourceFile] => isWorkspaceResourceFile(entry[1]))
      .map(([key, file]) => [key, file.path]),
  )
}

function resourceRecordValues(value: unknown): WorkspaceResourceFile[] {
  if (isWorkspaceResourceFile(value)) return [value]
  if (!isRecord(value)) return []
  return Object.values(value).filter(isWorkspaceResourceFile)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
  )
}

function formatErrorMessage(prefix: string, error: unknown): string {
  if (error instanceof Error) return `${prefix}: ${error.message}`
  return prefix
}
