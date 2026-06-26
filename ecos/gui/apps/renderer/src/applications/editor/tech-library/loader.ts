import type { WorkspaceResourceIndex } from '@ecos-studio/shared'
import { readProjectTextFile } from '@/utils/projectFiles'
import type {
  TechCellMaster,
  TechJsonFile,
  TechLayer,
  TechLibraryData,
  TechSite,
  TechViaMaster,
} from './types'

export interface TechLibraryReader {
  readText(path: string): Promise<string>
}

export interface LoadTechLibraryOptions {
  projectPath?: string
  readText?: (path: string) => Promise<string>
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${String(error)}`)
  }
}

function validateTechFile<T>(raw: TechJsonFile, expectedKind: string): T[] {
  if (raw.schema !== 'ecc.view.v1' || raw.kind !== expectedKind || !Array.isArray(raw.data)) {
    throw new Error(`Unsupported ${expectedKind.replace(/_/g, ' ')} tech file.`)
  }
  return raw.data as T[]
}

async function readTechArray<T>(
  readText: (path: string) => Promise<string>,
  path: string,
  kind: string,
): Promise<T[]> {
  const raw = parseJson<TechJsonFile>(await readText(path), path)
  return validateTechFile<T>(raw, kind)
}

export async function loadTechLibrary(
  index: WorkspaceResourceIndex,
  options: LoadTechLibraryOptions = {},
): Promise<TechLibraryData> {
  const tech = index.tech
  if (!tech) {
    throw new Error('Workspace has no Tech Library resources.')
  }

  const readText = options.readText
    ?? ((path: string) => readProjectTextFile(path, { projectPath: options.projectPath }))

  const [layers, sites, vias, cellMasters] = await Promise.all([
    readTechArray<TechLayer>(readText, tech.layers.path, 'layers'),
    readTechArray<TechSite>(readText, tech.sites.path, 'sites'),
    readTechArray<TechViaMaster>(readText, tech.vias.path, 'via_masters'),
    readTechArray<TechCellMaster>(readText, tech.cellMasters.path, 'cell_masters'),
  ])

  return {
    summary: {
      pdk: index.pdk,
      design: index.design,
      packageRoot: tech.packageRoot,
      layerCount: layers.length,
      siteCount: sites.length,
      viaCount: vias.length,
      cellMasterCount: cellMasters.length,
    },
    layers,
    sites,
    vias,
    cellMasters,
    layerById: new Map(layers.map((layer) => [layer.id, layer])),
    cellMasterById: new Map(cellMasters.map((cell) => [cell.id, cell])),
  }
}
