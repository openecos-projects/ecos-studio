export interface DesktopHdlDesignCandidate {
  clock?: string
  confidence: number
  designName: string
  filelistPath?: string
  id: string
  reasons: string[]
  rtlPath: string
  sdcPath?: string
  topModule?: string
}

export interface DesktopHdlDesignIndexQuery {
  designName?: string
  limit?: number
}

export interface DesktopHdlDesignIndexStatus {
  indexedAt?: string
  message?: string
  rootCount: number
  state: 'building' | 'disabled' | 'error' | 'idle' | 'ready'
}
