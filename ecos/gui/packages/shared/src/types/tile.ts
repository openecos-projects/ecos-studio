export interface TileGenerationRequest {
  projectPath: string
  layoutJsonRelative: string
  stepKey: string
}

export interface TileGenerationResult {
  baseUrl: string
  outDir: string
  fromCache: boolean
}

export type TileGenerationStatus = TileGenerationResult
