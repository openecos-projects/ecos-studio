export type WorkspaceResourceStatus = 'available' | 'missing' | 'error';

export interface WorkspaceResourceFile {
  path: string;
  exists: boolean;
  kind:
    | 'home'
    | 'flow'
    | 'parameters'
    | 'checklist'
    | 'layout-image'
    | 'layout-json'
    | 'view-json'
    | 'tech-json'
    | 'metrics'
    | 'analysis'
    | 'subflow'
    | 'config'
    | 'log'
    | 'report'
    | 'script'
    | 'output'
    | 'unknown';
  sizeBytes?: number;
  mtimeMs?: number;
}

export interface WorkspaceStepResource {
  name: string;
  tool: string;
  state: string;
  runtime: string;
  directory: string;
  info: Record<string, unknown>;
  resources: {
    output: Record<string, WorkspaceResourceFile>;
    data: Record<string, WorkspaceResourceFile>;
    feature: Record<string, WorkspaceResourceFile>;
    report: Record<string, WorkspaceResourceFile | Record<string, WorkspaceResourceFile>>;
    log: Record<string, WorkspaceResourceFile>;
    script: Record<string, WorkspaceResourceFile>;
    analysis: Record<string, WorkspaceResourceFile>;
    subflow: Record<string, WorkspaceResourceFile>;
    checklist: Record<string, WorkspaceResourceFile>;
    config: Record<string, WorkspaceResourceFile>;
  };
}

export interface WorkspaceTechResources {
  packageRoot: string;
  source: 'view-package';
  manifest: WorkspaceResourceFile;
  meta?: WorkspaceResourceFile;
  layers: WorkspaceResourceFile;
  sites: WorkspaceResourceFile;
  vias: WorkspaceResourceFile;
  cellMasters: WorkspaceResourceFile;
}

export interface WorkspaceResourceIndex {
  root: string;
  design: string;
  topModule: string;
  pdk: string;
  home: {
    homeJson: WorkspaceResourceFile;
    flowJson: WorkspaceResourceFile;
    parametersJson: WorkspaceResourceFile;
    checklistJson: WorkspaceResourceFile;
  };
  homeData: Record<string, unknown> | null;
  parameters: Record<string, unknown> | null;
  flow: {
    steps: WorkspaceStepResource[];
  };
  tech?: WorkspaceTechResources;
  status: WorkspaceResourceStatus;
  messages: string[];
}

export interface WorkspaceStepInfoRequest {
  step: string;
  id: 'views' | 'layout' | 'metrics' | 'subflow' | 'analysis' | 'maps' | 'checklist' | 'sta' | 'config';
}

export interface WorkspaceStepInfoResult {
  step: string;
  id: WorkspaceStepInfoRequest['id'];
  response: WorkspaceResourceStatus;
  info: Record<string, unknown>;
  missing: string[];
  message: string[];
}
