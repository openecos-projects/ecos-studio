import { cp, mkdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parse } from 'smol-toml'
import { repoRoot } from './launch'

export interface E2EDesignInput {
  inputId: string
  role: string
  path: string
}

/**
 * Project-level RTL import selection, handed to the create mutation so the
 * journey exercises `ecc init` + `ecc rtl import`.
 */
export interface E2EDesignRtlImport {
  filelist?: string
  verilog?: string[]
}

export interface E2EDesign {
  name: string
  /** Created (empty until `ecc init`) project directory under <outDir>/work/<name>. */
  projectRoot: string
  designName: string
  topModule: string
  clockPort: string
  frequencyMhz: number
  /** RTL sources imported into the project at creation. */
  rtlImport: E2EDesignRtlImport
  /** Workspace-level inputs (netlist/def/sdc) outside the RTL import. */
  inputs: E2EDesignInput[]
  parameters: Record<string, unknown>
}

const ROLE_BY_EXTENSION: Record<string, string> = {
  '.v': 'rtl',
  '.sv': 'rtl',
  '.sdc': 'sdc',
  '.f': 'filelist',
}

function roleFor(path: string): string {
  const extension = path.slice(path.lastIndexOf('.'))
  return ROLE_BY_EXTENSION[extension] ?? 'rtl'
}

interface EccTomlDesign {
  design?: {
    name?: string
    top?: string
    rtl?: string[]
    clock_port?: string
    frequency_mhz?: number
  }
  params?: Record<string, Record<string, unknown> | unknown>
}

/**
 * Load a design directory containing an ecc.toml (an ecc-ci-designs style
 * self-contained project). The design itself stays untouched as the import
 * SOURCE; the project root is created empty so `ecc init` accepts it and
 * `ecc rtl import` copies the sources into <projectRoot>/rtl/.
 */
export async function prepareDesignProject(
  designDir: string,
  workRoot: string,
): Promise<E2EDesign> {
  const toml = parse(await readFile(join(designDir, 'ecc.toml'), 'utf8')) as EccTomlDesign
  const design = toml.design ?? {}
  const name = design.name ?? basename(designDir)
  const projectRoot = join(workRoot, name)
  const sourceRoot = join(workRoot, `${name}-src`)
  await mkdir(workRoot, { recursive: true })
  await mkdir(projectRoot, { recursive: true })
  await cp(designDir, sourceRoot, { recursive: true })

  const rtl = design.rtl ?? []
  if (rtl.length === 0) throw new Error(`${designDir}/ecc.toml declares no rtl sources`)
  const rtlPaths = rtl.map((relative) => join(sourceRoot, relative))
  const filelistPath = rtlPaths.find((path) => roleFor(path) === 'filelist')
  const rtlImport: E2EDesignRtlImport = filelistPath
    ? { filelist: filelistPath }
    : { verilog: rtlPaths.filter((path) => roleFor(path) === 'rtl') }
  // Non-RTL declarations (e.g. an .sdc listed alongside the RTL) stay
  // workspace-level inputs pointing at the staged source copy.
  const inputs = rtlPaths
    .filter((path) => !filelistPath && roleFor(path) === 'sdc')
    .map((path, index) => ({
      inputId: `src-${index + 1}`,
      role: 'sdc',
      path,
    }))

  const parameters: Record<string, unknown> = {}
  for (const [section, values] of Object.entries(toml.params ?? {})) {
    if (values !== null && typeof values === 'object') {
      for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
        parameters[`${section}.${key}`] = value
      }
    } else {
      parameters[section] = values
    }
  }

  return {
    name,
    projectRoot,
    designName: design.name ?? name,
    topModule: design.top ?? design.name ?? name,
    clockPort: design.clock_port ?? 'clk',
    frequencyMhz: design.frequency_mhz ?? 100,
    rtlImport,
    inputs,
    parameters,
  }
}

/**
 * Default local design: the gcd example shipped in the ecc submodule (no
 * ecc.toml there, so the config is synthesized here). The source stays
 * outside the project root so `ecc rtl import` copies it into rtl/.
 */
export async function prepareGcdProject(workRoot: string): Promise<E2EDesign> {
  const projectRoot = join(workRoot, 'gcd')
  const sourceRoot = join(workRoot, 'gcd-src')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(sourceRoot, { recursive: true })
  await cp(join(repoRoot, 'ecc/docs/examples/gcd/gcd.v'), join(sourceRoot, 'gcd.v'))
  return {
    name: 'gcd',
    projectRoot,
    designName: 'gcd',
    topModule: 'gcd',
    clockPort: 'clk',
    frequencyMhz: 100,
    rtlImport: { verilog: [join(sourceRoot, 'gcd.v')] },
    inputs: [],
    parameters: {
      'floorplan.core_util': 0.6,
      'cts.max_fanout': 20,
      'place.target_density': 0.2,
    },
  }
}

/** ECOS_E2E_DESIGN_DIR selects an ecc-ci-designs style design; gcd otherwise. */
export async function prepareDesign(workRoot: string): Promise<E2EDesign> {
  const designDir = process.env.ECOS_E2E_DESIGN_DIR
  return designDir
    ? prepareDesignProject(designDir, workRoot)
    : prepareGcdProject(workRoot)
}
