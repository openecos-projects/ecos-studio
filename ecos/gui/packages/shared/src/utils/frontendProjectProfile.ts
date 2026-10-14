import {
  frontendDesignKindFromConfig,
  type FrontendDesignKind,
} from './frontendDesign.ts'
import type {
  ProjectManifest,
  ProjectManifestWorkspaceRegistrationInput,
} from './projectManifest.ts'

/** The first workspace chooses the project profile; legacy projects are CPU projects. */
export function resolveFrontendProjectKind(
  manifest: ProjectManifest,
  config?: ProjectManifestWorkspaceRegistrationInput['config'],
): FrontendDesignKind {
  const projectKind = frontendDesignKindFromConfig(manifest.base_design)
  const requested =
    config?.frontend_design_kind ?? config?.parameters?.frontend_design_kind
  const kind = requested == null ? projectKind : frontendDesignKindFromConfig(config)
  const locked =
    manifest.workspaces.length > 0 ||
    manifest.base_design.frontend_design_kind != null ||
    manifest.base_design.parameters?.frontend_design_kind != null
  if (locked && kind !== projectKind) {
    throw new Error(
      `Frontend project profile is locked to ${projectKind}. Create a separate project for ${kind}.`,
    )
  }
  return kind
}
