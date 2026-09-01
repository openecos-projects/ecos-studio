# ECOS Studio Application

These instructions apply to the application code under `ecos/` and supplement
the repository-root `AGENTS.md`.

## Architecture

- The Vue renderer presents workspaces and flows but delegates privileged work
  through the Electron desktop bridge.
- Electron main owns filesystem access, workspace mutation, subprocess
  lifecycle, and integration with ECC, ECC-FE, the Agent, and Chip Viewer.
- ECC supplies the packaged RTL-to-GDS runtime.
- ECC-FE runs as a process-isolated front-end runtime. Packaged installations
  use the runtime installed by Resource Manager; source development requires an
  explicit override.
- The Agent produces bounded proposals while ECOS Studio retains validation,
  confirmation, execution, and result recording.
- Chip Viewer remains a native process so Rust rendering and large layout data
  stay outside the Electron renderer.

## Implementation Guidance

- Add new behavior to focused modules instead of growing central orchestration
  files.
- Target new hand-written production files under 500 LoC.
- When a file exceeds roughly 800 LoC, add new functionality in a separate
  responsibility-focused module unless there is a strong reason to keep it
  cohesive.
- Do not reduce file size by removing validation, error handling, security, or
  readability. Generated code, vendored code, fixtures, snapshots, lockfiles,
  and declarative data are exempt.

## Cross-Component Changes

- Trace a contract through every producer and consumer before changing it.
- Keep cross-process validation at the authoritative backend boundary.
- When a change spans Python, TypeScript, Rust, or a submodule, run the focused
  checks in every affected component.
- Treat persisted workspace and project formats as integration contracts; update
  migration and recovery tests when their shapes change.

## Packaging

- `.github/scripts/build-binaries.sh` builds and stages ECC, Chip Viewer, and the
  packaged Agent before Electron packaging.
- Do not edit `gui/apps/desktop-electron/resources/`, `release/`, `dist/`,
  `build/`, or `target/` outputs by hand.
- For changes to integration scripts, packaged binaries, manifests, or Electron
  release inputs, run `make build` from the repository root or report why it was
  not run.
