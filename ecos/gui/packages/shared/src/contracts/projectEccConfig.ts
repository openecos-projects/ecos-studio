/**
 * Project ecc.toml PDK configuration contract.
 *
 * ECOS Studio records project-level external PDK paths (for example SRAM
 * macro directories that live outside the imported PDK root) and the manual
 * PDK resource override in the owning project's `ecc.toml`, so both the
 * ECC CLI (`[pdk.overrides]` on fresh runs) and future wizard sessions see
 * the same declaration.
 */

/** [pdk.overrides] path fields managed by the wizard; whole-field replace. */
export interface EccPdkOverrides {
  tech?: string
  lefs?: string[]
  libs?: string[]
}

/** GUI view of the ecc.toml [pdk] section; values stay as written. */
export interface ProjectEccPdkConfig {
  externalPaths: string[]
  overrides: EccPdkOverrides
}

export interface ProjectEccPdkConfigReadResult extends ProjectEccPdkConfig {
  /** False when the project has no ecc.toml yet. */
  exists: boolean
}

export interface ProjectEccPdkConfigWriteRequest {
  projectRoot: string
  /** Resolves and relativizes in-root entries; also written for new files. */
  pdkRoot?: string
  /** Written as `[pdk] name` when ecc.toml has to be created. */
  pdkName?: string
  /** Absolute directory paths; replaces the list wholesale. */
  externalPaths?: string[]
  /**
   * Whole-field replacement per key: `undefined` keeps the stored value,
   * an empty scalar/list removes the key. Absolute entries stay absolute
   * (ECC resolves them as-is); entries inside `pdkRoot` are relativized.
   */
  overrides?: EccPdkOverrides
}

/**
 * Persistence payload carried on workspace create/update requests. The
 * Electron bridge strips it before forwarding the request to ECC and writes
 * ecc.toml itself.
 */
export interface EccWorkspacePdkConfigPersist {
  externalPaths?: string[]
  overrides?: EccPdkOverrides
}
