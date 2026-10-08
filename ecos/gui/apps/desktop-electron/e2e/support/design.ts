import { cp, mkdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parse } from 'smol-toml'
import { repoRoot } from './launch'

export interface E2EDesignInput {
  inputId: string
  role: string
  path: string
}

export interface E2EDesign {
  name: string
  /** Copied project directory under <outDir>/work/<name>. */
  projectRoot: string
  designName: string
  topModule: string
  clockPort: string
  frequencyMhz: number
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
 * self-contained project) and copy it to the e2e work root, mirroring what
 * ECC CI's run-designs.sh does before invoking the flow.
 */
export async function prepareDesignProject(
  designDir: string,
  workRoot: string,
): Promise<E2EDesign> {
  const toml = parse(await readFile(join(designDir, 'ecc.toml'), 'utf8')) as EccTomlDesign
  const design = toml.design ?? {}
  const name = design.name ?? basename(designDir)
  const projectRoot = join(workRoot, name)
  await mkdir(workRoot, { recursive: true })
  await cp(designDir, projectRoot, { recursive: true })

  const rtl = design.rtl ?? []
  if (rtl.length === 0) throw new Error(`${designDir}/ecc.toml declares no rtl sources`)
  const inputs = rtl.map((relative, index) => ({
    inputId: `src-${index + 1}`,
    role: roleFor(relative),
    path: join(projectRoot, relative),
  }))

  const parameters: Record<string, unknown> = {}
  for (const [section, values] of Object.entries(toml.params ?? {})) {
    if (values !== null && typeof values === 'object') {
      for (const [key, value] of Object.entries(values)) {
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
    inputs,
    parameters,
  }
}

/**
 * Default local design: the gcd example shipped in the ecc submodule (no
 * ecc.toml there, so the config is synthesized here).
 */
export async function prepareGcdProject(workRoot: string): Promise<E2EDesign> {
  const projectRoot = join(workRoot, 'gcd')
  await mkdir(join(projectRoot, 'rtl'), { recursive: true })
  await cp(
    join(repoRoot, 'ecc/docs/examples/gcd/gcd.v'),
    join(projectRoot, 'rtl', 'gcd.v'),
  )
  return {
    name: 'gcd',
    projectRoot,
    designName: 'gcd',
    topModule: 'gcd',
    clockPort: 'clk',
    frequencyMhz: 100,
    inputs: [{ inputId: 'src-1', role: 'rtl', path: join(projectRoot, 'rtl', 'gcd.v') }],
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
